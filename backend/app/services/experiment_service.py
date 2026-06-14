"""
Experiment service.

Creates ExperimentRun entries and orchestrates the evaluation pipeline.
The heavy `_execute_model_runs` method is designed to be called from a Celery task
later — for now it runs synchronously.
"""
from __future__ import annotations

import json
import logging
import math
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
import random
from statistics import median

import pandas as pd
from fastapi import HTTPException
from sqlmodel import Session, select

from db_models.dataset import Dataset, DatasetStatus, DatasetType
from db_models.model import Model, JudgeModel
from db_models.experiment import (
    Experiment, ExperimentRun, StatusType, JudgeType,
)
from schemas.experiment import JudgeConfig
from core.model_client import LLMResponse
from core.model_adapter import get_model_client
from core.pricing import calculate_cost, estimate_token_count, openrouter_model_id
from core.judges import create_judge

logger = logging.getLogger(__name__)

RUNS_DIR = Path(__file__).resolve().parent.parent.parent / "runs"
CONCURRENT_REQUESTS = 3

# Which judge types are allowed for each dataset type
ALLOWED_JUDGES: dict[DatasetType, set[JudgeType]] = {
    DatasetType.MC_WITH_TRUE: {JudgeType.EQUALS, JudgeType.LLM_BOOL, JudgeType.LLM_SCORE},
    DatasetType.OPEN_WITH_TRUE: {
        JudgeType.EQUALS, JudgeType.CONTAINS, JudgeType.JSON_EQUALITY,
        JudgeType.LLM_BOOL, JudgeType.LLM_SCORE, JudgeType.SIMILARITY,
    },
    DatasetType.NO_TRUE_ANSWER: {JudgeType.LLM_BOOL, JudgeType.LLM_SCORE},
}


def _percentile(values: list[float], percentile: float) -> float | None:
    if not values:
        return None
    ordered = sorted(values)
    index = math.ceil((percentile / 100) * len(ordered)) - 1
    return ordered[max(0, min(index, len(ordered) - 1))]


def _latency_stats(values: list[float | None]) -> dict[str, float | int | None]:
    valid = [value for value in values if value is not None]
    return {
        "mean_ms": sum(valid) / len(valid) if valid else None,
        "median_ms": median(valid) if valid else None,
        "p95_ms": _percentile(valid, 95),
        "count": len(valid),
    }


class ExperimentService:
    def __init__(self, session: Session) -> None:
        self.session = session

    # ── Validation & creation ─────────────────────────────────────────

    def create_experiment(self, payload, user_id: int) -> Experiment:
        dataset = self.session.get(Dataset, payload.dataset_id)
        if not dataset:
            raise HTTPException(404, "Dataset not found")
        if dataset.status != DatasetStatus.READY:
            raise HTTPException(400, "Dataset is not ready (complete column mapping first)")

        # Validate models exist
        for mid in payload.candidate_model_ids:
            if not self.session.get(Model, mid):
                raise HTTPException(404, f"Candidate model {mid} not found")

        # Validate judge configs
        llm_types = {JudgeType.LLM_SCORE, JudgeType.LLM_BOOL}
        allowed = ALLOWED_JUDGES[dataset.dataset_type]
        for jc in payload.judge_configs:
            if jc.judge_type not in allowed:
                raise HTTPException(
                    400,
                    f"Judge '{jc.judge_type}' not allowed for dataset type '{dataset.dataset_type}'",
                )
            if jc.judge_type in llm_types:
                if jc.judge_model_id is None:
                    raise HTTPException(400, f"judge_model_id required for {jc.judge_type}")
                if not self.session.get(JudgeModel, jc.judge_model_id):
                    raise HTTPException(404, f"Judge model {jc.judge_model_id} not found")

        # Validate sample_size
        if payload.sample_size <= 0:
            raise HTTPException(400, "sample_size must be > 0")
        if payload.sample_size > dataset.number_of_questions:
            raise HTTPException(400, "sample_size > number of questions in dataset")
        if payload.measure_k is not None:
            if payload.measure_k < 0:
                raise HTTPException(400, "measure_k must be >= 0")
            if payload.measure_k > payload.sample_size:
                raise HTTPException(400, "measure_k cannot exceed sample_size")

        experiment = Experiment(
            name=payload.name,
            description=payload.description,
            system_prompt_override=payload.system_prompt_override or None,
            dataset_id=payload.dataset_id,
            candidate_model_ids=payload.candidate_model_ids,
            judge_configs=[jc.model_dump() for jc in payload.judge_configs],
            sample_size=payload.sample_size,
            seed=payload.seed,
            measure_k=payload.measure_k or 0,
            status=StatusType.PENDING,
            user_id=user_id,
        )
        self.session.add(experiment)
        self.session.commit()
        self.session.refresh(experiment)
        return experiment

    # ── Run experiment ────────────────────────────────────────────────

    def run_experiment(self, experiment_id: int) -> Experiment:
        experiment = self.session.get(Experiment, experiment_id)
        if not experiment:
            raise HTTPException(404, "Experiment not found")

        if experiment.status != StatusType.RUNNING:
            raise HTTPException(409, f"Cannot run experiment in '{experiment.status}' state")

        dataset = self.session.get(Dataset, experiment.dataset_id)

        try:
            df_all = self._load_mapped_df(dataset)

            df_sample = df_all.sample(
                n=min(experiment.sample_size, len(df_all)),
                random_state=experiment.seed,
            ).reset_index(drop=True)

            # Load existing runs (retry scenario: skip already-completed ones)
            existing_runs = self.session.exec(
                select(ExperimentRun).where(ExperimentRun.experiment_id == experiment.id)
            ).all()
            existing_map = {
                (r.model_id, r.judge_type, r.judge_model_id): r
                for r in existing_runs
            }

            runs: list[ExperimentRun] = []
            for model_id in experiment.candidate_model_ids:
                for jc_dict in experiment.judge_configs:
                    jc = JudgeConfig(**jc_dict)
                    key = (model_id, jc.judge_type, jc.judge_model_id)
                    existing = existing_map.get(key)

                    if existing and existing.status == StatusType.COMPLETED:
                        runs.append(existing)
                        continue

                    if existing:
                        existing.status = StatusType.PENDING
                        existing.error_message = None
                        self.session.add(existing)
                        runs.append(existing)
                    else:
                        run = ExperimentRun(
                            experiment_id=experiment.id,
                            model_id=model_id,
                            judge_type=jc.judge_type,
                            judge_model_id=jc.judge_model_id,
                            status=StatusType.PENDING,
                        )
                        self.session.add(run)
                        runs.append(run)
            self.session.commit()

            # Group pending runs by model_id — call each candidate model only once
            runs_by_model: dict[int, list[ExperimentRun]] = {}
            for run in runs:
                if run.status != StatusType.COMPLETED:
                    runs_by_model.setdefault(run.model_id, []).append(run)

            if len(runs_by_model) <= 1:
                for model_id, model_runs in runs_by_model.items():
                    self._execute_model_runs(model_id, model_runs, df_sample, dataset, experiment)
            else:
                tasks = [
                    (mid, [r.id for r in mrs], df_sample, dataset.id, experiment.id)
                    for mid, mrs in runs_by_model.items()
                ]
                with ThreadPoolExecutor(max_workers=len(tasks)) as pool:
                    list(pool.map(lambda t: _run_model_isolated(*t), tasks))
                # Isolated sessions updated the DB — expire cache and re-read
                self.session.expire_all()
                candidate_ids = set(experiment.candidate_model_ids)
                runs = [
                    r for r in self.session.exec(
                        select(ExperimentRun).where(ExperimentRun.experiment_id == experiment.id)
                    ).all()
                    if r.model_id in candidate_ids
                ]

            all_failed = all(r.status == StatusType.FAILED for r in runs)
            experiment.status = StatusType.FAILED if all_failed else StatusType.COMPLETED
        except Exception as e:
            logger.exception("Experiment %d failed: %s", experiment_id, e)
            experiment.status = StatusType.FAILED
        finally:
            from datetime import datetime, timezone
            experiment.updated_at = datetime.now(timezone.utc)
            self.session.add(experiment)
            self.session.commit()
            self.session.refresh(experiment)

        return experiment

    # ── Model call (once per model) ───────────────────────────────────

    def _execute_model_runs(
        self,
        model_id: int,
        runs: list[ExperimentRun],
        df_sample: pd.DataFrame,
        dataset: Dataset,
        experiment: Experiment,
    ) -> None:
        """Call candidate model once, then evaluate each judge run independently."""
        for run in runs:
            run.status = StatusType.RUNNING
            self.session.add(run)
        self.session.commit()

        model = self.session.get(Model, model_id)

        # ── Step 1: Get answers from candidate model ──
        try:
            client = get_model_client(model)
            if experiment.system_prompt_override is not None:
                client.system_prompt = experiment.system_prompt_override
            df = df_sample.copy()

            def _call_single(row):
                prompt = self._build_prompt(row, dataset.dataset_type)
                p_tokens_est = estimate_token_count(prompt) + estimate_token_count(model.system_prompt)
                try:
                    resp = client.generate(prompt)
                    if resp.prompt_tokens is not None and resp.completion_tokens is not None:
                        p_tokens, c_tokens, real = resp.prompt_tokens, resp.completion_tokens, True
                    else:
                        p_tokens = p_tokens_est
                        c_tokens = estimate_token_count(resp.content)
                        real = False
                    cost = calculate_cost(model.provider, model.model_name, p_tokens, c_tokens)
                    return prompt, resp.content, resp.ttft_ms, resp.e2e_ms, p_tokens, c_tokens, cost, real
                except Exception as e:
                    logger.warning("Model call failed for row: %s", e)
                    return prompt, "", None, None, p_tokens_est, 0, 0.0, False

            rows = [row for _, row in df.iterrows()]
            with ThreadPoolExecutor(max_workers=CONCURRENT_REQUESTS) as executor:
                call_results = list(executor.map(_call_single, rows))

            prompts           = [r[0] for r in call_results]
            answers           = [r[1] for r in call_results]
            ttfts             = [r[2] for r in call_results]
            e2es              = [r[3] for r in call_results]
            prompt_tokens     = [r[4] for r in call_results]
            completion_tokens = [r[5] for r in call_results]
            estimated_costs   = [r[6] for r in call_results]
            used_real_tokens  = any(r[7] for r in call_results)

            df["prompt"] = prompts
            df["model_answer"] = answers
            df["prompt_tokens"] = prompt_tokens
            df["completion_tokens"] = completion_tokens
            df["estimated_cost_usd"] = estimated_costs

            if all(a == "" for a in answers):
                raise Exception("All model calls failed. Check API key and credits.")

        except Exception as e:
            logger.exception("Model call failed for model %d: %s", model_id, e)
            for run in runs:
                run.status = StatusType.FAILED
                run.error_message = str(e)
                self.session.add(run)
            self.session.commit()
            return

        # Aggregate token/cost/latency stats once for all judge runs
        total_prompt_tokens = int(sum(prompt_tokens))
        total_completion_tokens = int(sum(completion_tokens))
        total_tokens = total_prompt_tokens + total_completion_tokens
        estimated_total_cost_usd = round(float(sum(estimated_costs)), 6)
        pricing_model_id = openrouter_model_id(model.provider, model.model_name)

        measure_k = experiment.measure_k or 0
        k = min(measure_k, len(e2es)) if measure_k > 0 else len(e2es)
        if k == len(e2es):
            indices = list(range(len(e2es)))
        else:
            rng = random.Random(experiment.seed)
            indices = rng.sample(range(len(e2es)), k)

        e2e_stats = _latency_stats([e2es[i] for i in indices])
        ttft_stats = _latency_stats([ttfts[i] for i in indices])

        # ── Step 2: Judge each run independently using shared model responses ──
        for run in runs:
            self.session.refresh(run)
            if run.status == StatusType.CANCELLED:
                continue
            self._evaluate_run(
                run=run,
                df=df.copy(),
                dataset=dataset,
                experiment=experiment,
                judge_model_db=self.session.get(JudgeModel, run.judge_model_id) if run.judge_model_id else None,
                total_prompt_tokens=total_prompt_tokens,
                total_completion_tokens=total_completion_tokens,
                total_tokens=total_tokens,
                estimated_total_cost_usd=estimated_total_cost_usd,
                pricing_model_id=pricing_model_id,
                e2e_stats=e2e_stats,
                ttft_stats=ttft_stats,
                used_real_tokens=used_real_tokens,
            )

    # ── Judge evaluation (once per run) ──────────────────────────────

    def _evaluate_run(
        self,
        run: ExperimentRun,
        df: pd.DataFrame,
        dataset: Dataset,
        experiment: Experiment,
        judge_model_db: JudgeModel | None,
        total_prompt_tokens: int,
        total_completion_tokens: int,
        total_tokens: int,
        estimated_total_cost_usd: float,
        pricing_model_id: str,
        e2e_stats: dict,
        ttft_stats: dict,
        used_real_tokens: bool,
    ) -> None:
        try:
            judge = create_judge(run.judge_type, judge_model_db)
            df = judge.check_answers(df)

            is_score = run.judge_type == JudgeType.LLM_SCORE
            is_similarity = run.judge_type == JudgeType.SIMILARITY

            if is_similarity:
                _sim_keys = ("bleu", "rouge_l", "cer", "semantic_similarity", "perplexity")
                sim = {}
                for key in _sim_keys:
                    if key in df.columns:
                        valid = df[key].dropna()
                        sim[f"avg_{key}"] = float(valid.mean()) if len(valid) > 0 else None
                    else:
                        sim[f"avg_{key}"] = None
                run.similarity_metrics = sim
                run.evaluated_count = len(df)
                run.invalid_count = 0
            elif is_score:
                valid = df["score"].dropna()
                run.evaluated_count = len(valid)
                run.invalid_count = int(df["score"].isna().sum())
                run.average_score = float(valid.mean()) if len(valid) > 0 else None
                if run.average_score is not None and judge_model_db:
                    smin = judge_model_db.score_min or 0
                    smax = judge_model_db.score_max or 10
                    if smax > smin:
                        run.normalized_average_score = (run.average_score - smin) / (smax - smin)
            else:
                total = len(df)
                valid_mask = df["is_correct"].notna()
                run.evaluated_count = int(valid_mask.sum())
                run.invalid_count = total - run.evaluated_count
                run.correct_count = int(df.loc[valid_mask, "is_correct"].sum())
                run.accuracy = (
                    run.correct_count / run.evaluated_count
                    if run.evaluated_count > 0 else None
                )

            # Latency (from shared model call)
            run.e2e_response_time_ms = e2e_stats["mean_ms"]
            run.e2e_response_time_median_ms = e2e_stats["median_ms"]
            run.e2e_response_time_p95_ms = e2e_stats["p95_ms"]
            run.latency_ttft_ms = ttft_stats["mean_ms"]
            run.latency_ttft_median_ms = ttft_stats["median_ms"]
            run.latency_ttft_p95_ms = ttft_stats["p95_ms"]
            run.latency_sample_count = max(e2e_stats["count"], ttft_stats["count"])
            run.latency_measure_k = experiment.measure_k or 0

            # Token/cost (from shared model call)
            run.prompt_tokens = total_prompt_tokens
            run.completion_tokens = total_completion_tokens
            run.total_tokens = total_tokens
            run.estimated_cost_usd = estimated_total_cost_usd
            run.pricing_model_id = pricing_model_id
            run.pricing_source = "openrouter"
            run.token_count_method = "api_reported" if used_real_tokens else "estimated_chars_div_4"

            # Per-category breakdown
            if "category" in df.columns:
                cat_metrics = {}
                for cat, group in df.groupby("category"):
                    entry = {
                        "count": len(group),
                        "prompt_tokens": int(group["prompt_tokens"].sum()),
                        "completion_tokens": int(group["completion_tokens"].sum()),
                        "total_tokens": int(
                            group["prompt_tokens"].sum() + group["completion_tokens"].sum()
                        ),
                        "estimated_cost_usd": round(float(group["estimated_cost_usd"].sum()), 6),
                    }
                    if is_similarity:
                        for key in ("bleu", "rouge_l", "cer", "semantic_similarity", "perplexity"):
                            if key in group.columns:
                                valid = group[key].dropna()
                                entry[f"avg_{key}"] = float(valid.mean()) if len(valid) > 0 else None
                    elif is_score:
                        valid_scores = group["score"].dropna()
                        entry["average_score"] = float(valid_scores.mean()) if len(valid_scores) > 0 else None
                        entry["evaluated"] = len(valid_scores)
                        entry["invalid"] = int(group["score"].isna().sum())
                    else:
                        valid = group["is_correct"].notna()
                        correct = int(group.loc[valid, "is_correct"].sum())
                        evaluated = int(valid.sum())
                        entry["correct"] = correct
                        entry["evaluated"] = evaluated
                        entry["invalid"] = len(group) - evaluated
                        entry["accuracy"] = correct / evaluated if evaluated > 0 else None
                    cat_metrics[str(cat)] = entry
                run.category_metrics = cat_metrics

            # Save outputs
            run_dir = RUNS_DIR / str(experiment.id) / str(run.id)
            run_dir.mkdir(parents=True, exist_ok=True)

            answers_path = run_dir / "answers.csv"
            df.to_csv(answers_path, index=False)
            run.answers_path = str(answers_path)

            metrics = {
                "experiment_id": experiment.id,
                "run_id": run.id,
                "model_id": run.model_id,
                "judge_type": run.judge_type,
                "judge_model_id": run.judge_model_id,
                "accuracy": run.accuracy,
                "average_score": run.average_score,
                "normalized_average_score": run.normalized_average_score,
                "correct_count": run.correct_count,
                "evaluated_count": run.evaluated_count,
                "invalid_count": run.invalid_count,
                "similarity_metrics": run.similarity_metrics,
                "e2e_response_time_ms": run.e2e_response_time_ms,
                "e2e_response_time_median_ms": run.e2e_response_time_median_ms,
                "e2e_response_time_p95_ms": run.e2e_response_time_p95_ms,
                "latency_ttft_ms": run.latency_ttft_ms,
                "latency_ttft_median_ms": run.latency_ttft_median_ms,
                "latency_ttft_p95_ms": run.latency_ttft_p95_ms,
                "latency_sample_count": run.latency_sample_count,
                "latency_measure_k": run.latency_measure_k,
                "category_metrics": run.category_metrics,
                "prompt_tokens": total_prompt_tokens,
                "completion_tokens": total_completion_tokens,
                "total_tokens": total_tokens,
                "estimated_cost_usd": estimated_total_cost_usd,
                "pricing_model_id": pricing_model_id,
                "pricing_source": run.pricing_source,
                "token_count_method": run.token_count_method,
            }
            metrics_path = run_dir / "metrics.json"
            metrics_path.write_text(json.dumps(metrics, indent=2, default=str))
            run.metrics_path = str(metrics_path)

            run.status = StatusType.COMPLETED

        except Exception as e:
            logger.exception("Run %d (judge eval) failed: %s", run.id, e)
            run.status = StatusType.FAILED
            run.error_message = str(e)

        self.session.add(run)
        self.session.commit()

    # ── Helpers ────────────────────────────────────────────────────────

    def _load_mapped_df(self, dataset: Dataset) -> pd.DataFrame:
        path = Path(dataset.file_path)
        ext = path.suffix.lower()
        if ext == ".csv":
            df = pd.read_csv(path)
        elif ext == ".jsonl":
            df = pd.read_json(path, lines=True)
        else:
            raise HTTPException(400, f"Unsupported: {ext}")

        mapping = dataset.column_mapping or {}
        rename = {}
        for role, col in mapping.items():
            if col in df.columns and role != col:
                rename[col] = role
        df = df.rename(columns=rename)
        return df

    def _build_prompt(self, row: pd.Series, dtype: DatasetType) -> str:
        parts = [str(row.get("question", ""))]
        if dtype == DatasetType.MC_WITH_TRUE and "options" in row:
            parts.append(f"\nOptions: {row['options']}")
        return "\n".join(parts)


def _run_model_isolated(
    model_id: int,
    run_ids: list[int],
    df_sample,
    dataset_id: int,
    experiment_id: int,
) -> None:
    """Execute one model's runs in an isolated DB session — safe to call from a thread."""
    from db import engine
    from sqlmodel import Session as _Session
    with _Session(engine) as session:
        svc = ExperimentService(session)
        dataset = session.get(Dataset, dataset_id)
        experiment = session.get(Experiment, experiment_id)
        runs = [session.get(ExperimentRun, rid) for rid in run_ids]
        runs = [r for r in runs if r is not None]
        if runs and dataset and experiment:
            svc._execute_model_runs(model_id, runs, df_sample, dataset, experiment)
