from __future__ import annotations

import datetime
import json
import shutil
from typing import List, Optional
from pathlib import Path

from fastapi import APIRouter, HTTPException, status, Query
from fastapi.responses import FileResponse
from sqlmodel import select

from db_models.dataset import Dataset
from deps import SessionDep, CurrentUserDep
from db_models.experiment import Experiment, ExperimentRun, StatusType
from db_models.model import Model
from schemas.experiment import AnalyzeRequest, ExperimentCreate, ExperimentRead, ExperimentRunRead, ExperimentUpdate
from services.experiment_service import ExperimentService
from core.model_adapter import get_model_client

router = APIRouter(prefix="/experiments", tags=["experiments"])

RUNS_DIR = Path(__file__).resolve().parent.parent.parent / "runs"

_ANALYSIS_PROMPT = """\
You are an expert LLM benchmark analyst. Analyze the following experiment results and produce a structured report.

## Experiment: {experiment_name}
- Dataset: {dataset_name} ({sample_size} samples)
- Judges used: {judge_types}

## Results by Model

{model_results_block}

---

Produce a concise analysis with exactly these sections. Omit a section entirely if no relevant data exists.

### Overall Ranking
Rank all models from best to worst. One sentence per model explaining why.

### Score vs Cost Trade-off
Compute or estimate score-per-dollar efficiency. Call out any model that delivers good results at lower cost, or any model where the premium is not justified by its scores.

### Latency
Compare mean and P95 end-to-end latency. Flag any model with high P95 variance (unreliable in production). Note if a fast model also scores well.

### Category Breakdown
Only if category data is present. Identify specialists vs generalists.

### Similarity Metrics
Only if BLEU/ROUGE/semantic similarity scores are present. Interpret what they reveal together — e.g. high BLEU but low semantic similarity suggests surface-level matching without real understanding.

### Recommendation
Two sentences maximum:
1. Best model for quality-first use cases.
2. Best model for cost-sensitive or latency-sensitive use cases.

Be direct. Cite specific numbers. Do not pad with disclaimers.
"""


def _build_results_block(runs: list["ExperimentRunRead"], model_names: dict) -> str:
    runs_by_model: dict = {}
    for run in runs:
        runs_by_model.setdefault(run.model_id, []).append(run)

    lines: list[str] = []
    for model_id, model_runs in runs_by_model.items():
        name = model_names.get(model_id, f"Model {model_id}")
        lines.append(f"### {name}")

        for run in model_runs:
            lines.append(f"**Judge: {run.judge_type}**")
            if run.accuracy is not None:
                lines.append(f"- Accuracy: {run.accuracy:.1%} ({run.correct_count}/{run.evaluated_count})")
            if run.average_score is not None:
                norm = f" (normalized: {run.normalized_average_score:.2f})" if run.normalized_average_score is not None else ""
                lines.append(f"- Avg Score: {run.average_score:.2f}{norm}")
            if run.similarity_metrics:
                sim = run.similarity_metrics
                parts = []
                for key, label in [
                    ("avg_bleu", "BLEU"),
                    ("avg_rouge_l", "ROUGE-L"),
                    ("avg_cer", "CER"),
                    ("avg_semantic_similarity", "Semantic Sim"),
                    ("avg_perplexity", "Perplexity"),
                ]:
                    v = sim.get(key)
                    if v is not None:
                        parts.append(f"{label}={v:.2f}")
                if parts:
                    lines.append(f"- Similarity: {', '.join(parts)}")
            if run.category_metrics:
                lines.append(f"- Category breakdown: {json.dumps(run.category_metrics)}")

        first = model_runs[0]
        if first.estimated_cost_usd is not None:
            tokens_str = f" ({first.total_tokens:,} tokens)" if first.total_tokens else ""
            lines.append(f"- Estimated cost: ${first.estimated_cost_usd:.6f}{tokens_str}")
        if first.e2e_response_time_ms is not None:
            p95 = f", P95={first.e2e_response_time_p95_ms:.0f}ms" if first.e2e_response_time_p95_ms is not None else ""
            median = f", median={first.e2e_response_time_median_ms:.0f}ms" if first.e2e_response_time_median_ms is not None else ""
            lines.append(f"- Latency E2E: mean={first.e2e_response_time_ms:.0f}ms{median}{p95}")
        if first.latency_ttft_ms is not None:
            ttft_median = f", median={first.latency_ttft_median_ms:.0f}ms" if first.latency_ttft_median_ms is not None else ""
            lines.append(f"- TTFT: mean={first.latency_ttft_ms:.0f}ms{ttft_median}")
        lines.append("")

    return "\n".join(lines)

RUN_METRIC_FIELDS = {
    "e2e_response_time_median_ms",
    "e2e_response_time_p95_ms",
    "latency_ttft_median_ms",
    "latency_ttft_p95_ms",
    "latency_sample_count",
    "latency_measure_k",
    "prompt_tokens",
    "completion_tokens",
    "total_tokens",
    "estimated_cost_usd",
    "pricing_model_id",
    "pricing_source",
    "token_count_method",
}


def _run_to_read(run: ExperimentRun) -> ExperimentRunRead:
    data = run.model_dump()
    if run.metrics_path:
        try:
            metrics = json.loads(Path(run.metrics_path).read_text(encoding="utf-8"))
            for field in RUN_METRIC_FIELDS:
                if data.get(field) is None and field in metrics:
                    data[field] = metrics[field]
        except Exception:
            pass
    return ExperimentRunRead(**data)


def _to_read(exp: Experiment, session) -> ExperimentRead:
    all_runs = session.exec(
        select(ExperimentRun).where(ExperimentRun.experiment_id == exp.id)
    ).all()
    candidate_ids = set(exp.candidate_model_ids)
    runs = [r for r in all_runs if r.model_id in candidate_ids]
    run_reads = [_run_to_read(r) for r in runs]
    # Each model is called once; all judge runs for the same model share the same
    # token/cost values. Deduplicate by model_id to avoid inflating totals.
    seen_model_ids: set[int] = set()
    prompt_tokens = completion_tokens = total_tokens = 0
    estimated_cost_usd = 0.0
    for r in run_reads:
        if r.model_id not in seen_model_ids:
            seen_model_ids.add(r.model_id)
            prompt_tokens += r.prompt_tokens or 0
            completion_tokens += r.completion_tokens or 0
            total_tokens += r.total_tokens or 0
            estimated_cost_usd += r.estimated_cost_usd or 0.0
    estimated_cost_usd = round(estimated_cost_usd, 6)
    return ExperimentRead(
        id=exp.id,
        name=exp.name,
        description=exp.description,
        dataset_id=exp.dataset_id,
        candidate_model_ids=exp.candidate_model_ids,
        judge_configs=exp.judge_configs,
        sample_size=exp.sample_size,
        seed=exp.seed,
        measure_k=exp.measure_k,
        status=exp.status,
        created_at=exp.created_at,
        updated_at=exp.updated_at,
        prompt_tokens=prompt_tokens,
        completion_tokens=completion_tokens,
        total_tokens=total_tokens,
        estimated_cost_usd=estimated_cost_usd,
        runs=run_reads,
    )


@router.post("/", response_model=ExperimentRead, status_code=status.HTTP_201_CREATED)
def create_experiment(payload: ExperimentCreate, session: SessionDep, current_user: CurrentUserDep):
    service = ExperimentService(session)
    exp = service.create_experiment(payload, user_id=current_user.id)
    return _to_read(exp, session)


@router.get("/", response_model=List[ExperimentRead])
def list_experiments(
    session: SessionDep,
    current_user: CurrentUserDep,
    status_filter: Optional[StatusType] = Query(default=None),
):
    stmt = select(Experiment).where(Experiment.user_id == current_user.id)
    if status_filter:
        stmt = stmt.where(Experiment.status == status_filter)
    return [_to_read(e, session) for e in session.exec(stmt).all()]


@router.get("/{experiment_id}", response_model=ExperimentRead)
def get_experiment(experiment_id: int, session: SessionDep, current_user: CurrentUserDep):
    exp = session.get(Experiment, experiment_id)
    if not exp or exp.user_id != current_user.id:
        raise HTTPException(404, "Experiment not found")
    return _to_read(exp, session)


@router.patch("/{experiment_id}", response_model=ExperimentRead)
def update_experiment(experiment_id: int, payload: ExperimentUpdate, session: SessionDep, current_user: CurrentUserDep):
    exp = session.get(Experiment, experiment_id)
    if not exp or exp.user_id != current_user.id:
        raise HTTPException(404, "Experiment not found")
    data = payload.model_dump(exclude_unset=True)
    if not data:
        raise HTTPException(400, "No fields to update")

    non_desc_fields = {k for k in data if k != "description"}
    if non_desc_fields and exp.status != StatusType.PENDING:
        raise HTTPException(409, "Only pending experiments can be updated")

    if non_desc_fields:
        final_sample = data.get("sample_size", exp.sample_size)
        final_measure_k = data.get("measure_k", exp.measure_k)

        if final_sample <= 0:
            raise HTTPException(400, "sample_size must be > 0")

        dataset = session.get(Dataset, exp.dataset_id)
        if final_sample > dataset.number_of_questions:
            raise HTTPException(400, "sample_size cannot exceed dataset question count")

        if final_measure_k is not None:
            if final_measure_k < 0:
                raise HTTPException(400, "measure_k must be >= 0")
            if final_measure_k > final_sample:
                raise HTTPException(400, "measure_k cannot exceed sample_size")
        elif "measure_k" in data:
            data["measure_k"] = 0

    for k, v in data.items():
        setattr(exp, k, v)

    exp.updated_at = datetime.datetime.now(datetime.timezone.utc)
    session.add(exp)
    session.commit()
    session.refresh(exp)
    return _to_read(exp, session)


@router.delete("/{experiment_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_experiment(
    experiment_id: int,
    session: SessionDep,
    current_user: CurrentUserDep,
    force: bool = Query(default=False),
):
    exp = session.get(Experiment, experiment_id)
    if not exp or exp.user_id != current_user.id:
        raise HTTPException(404, "Experiment not found")
    if exp.status == StatusType.RUNNING and not force:
        raise HTTPException(409, "Running experiments cannot be deleted. Use ?force=true to override.")

    runs = session.exec(
        select(ExperimentRun).where(ExperimentRun.experiment_id == exp.id)
    ).all()
    for r in runs:
        session.delete(r)
    session.flush()

    run_dir = RUNS_DIR / str(exp.id)
    if run_dir.exists():
        shutil.rmtree(run_dir, ignore_errors=True)

    session.delete(exp)
    session.commit()


@router.post("/{experiment_id}/reset", response_model=ExperimentRead)
def reset_experiment(experiment_id: int, session: SessionDep, current_user: CurrentUserDep):
    """Force-reset a stuck RUNNING experiment back to FAILED so it can be re-run."""
    exp = session.get(Experiment, experiment_id)
    if not exp or exp.user_id != current_user.id:
        raise HTTPException(404, "Experiment not found")
    if exp.status != StatusType.RUNNING:
        raise HTTPException(409, f"Only RUNNING experiments can be reset (current: {exp.status})")

    stale_runs = session.exec(
        select(ExperimentRun).where(
            ExperimentRun.experiment_id == experiment_id,
            ExperimentRun.status.in_([StatusType.RUNNING, StatusType.PENDING]),
        )
    ).all()
    for run in stale_runs:
        run.status = StatusType.FAILED
        run.error_message = "Reset by user (task was stuck)"
        session.add(run)

    exp.status = StatusType.FAILED
    exp.updated_at = datetime.datetime.now(datetime.timezone.utc)
    session.add(exp)
    session.commit()
    session.refresh(exp)
    return _to_read(exp, session)


@router.post("/{experiment_id}/runs/{run_id}/cancel", response_model=ExperimentRunRead)
def cancel_run(experiment_id: int, run_id: int, session: SessionDep, current_user: CurrentUserDep):
    exp = session.get(Experiment, experiment_id)
    if not exp or exp.user_id != current_user.id:
        raise HTTPException(404, "Experiment not found")
    run = session.get(ExperimentRun, run_id)
    if not run or run.experiment_id != experiment_id:
        raise HTTPException(404, "Run not found")
    if run.status != StatusType.RUNNING:
        raise HTTPException(409, f"Only running runs can be cancelled (current status: {run.status})")

    run.status = StatusType.CANCELLED
    run.error_message = "Cancelled by user"
    session.add(run)
    session.commit()
    session.refresh(run)
    return _run_to_read(run)


@router.post("/{experiment_id}/runs/{run_id}/rerun", status_code=status.HTTP_202_ACCEPTED)
def rerun_run(experiment_id: int, run_id: int, session: SessionDep, current_user: CurrentUserDep):
    exp = session.get(Experiment, experiment_id)
    if not exp or exp.user_id != current_user.id:
        raise HTTPException(404, "Experiment not found")
    if exp.status == StatusType.RUNNING:
        raise HTTPException(409, "Experiment is already running")
    run = session.get(ExperimentRun, run_id)
    if not run or run.experiment_id != experiment_id:
        raise HTTPException(404, "Run not found")
    if run.status != StatusType.CANCELLED:
        raise HTTPException(409, f"Only cancelled runs can be re-run (current status: {run.status})")

    run.status = StatusType.PENDING
    run.error_message = None
    session.add(run)

    exp.status = StatusType.RUNNING
    exp.updated_at = datetime.datetime.now(datetime.timezone.utc)
    session.add(exp)
    session.commit()

    from tasks.experiment_task import run_experiment_task
    run_experiment_task.delay(experiment_id)

    return {"message": "Run queued", "run_id": run_id, "experiment_id": experiment_id}


@router.post("/{experiment_id}/run", status_code=status.HTTP_202_ACCEPTED)
def run_experiment(experiment_id: int, session: SessionDep, current_user: CurrentUserDep):
    """Enqueue experiment to Celery. Returns immediately."""
    exp = session.get(Experiment, experiment_id)
    if not exp or exp.user_id != current_user.id:
        raise HTTPException(404, "Experiment not found")
    if exp.status not in (StatusType.PENDING, StatusType.FAILED, StatusType.COMPLETED):
        raise HTTPException(409, f"Cannot run experiment in '{exp.status}' state")

    exp.status = StatusType.RUNNING
    session.add(exp)
    session.commit()

    from tasks.experiment_task import run_experiment_task
    run_experiment_task.delay(experiment_id)

    return {"message": "Experiment queued", "experiment_id": experiment_id}


@router.post("/{experiment_id}/models/{model_id}", response_model=ExperimentRead)
def add_model_to_experiment(experiment_id: int, model_id: int, session: SessionDep, current_user: CurrentUserDep):
    exp = session.get(Experiment, experiment_id)
    if not exp or exp.user_id != current_user.id:
        raise HTTPException(404, "Experiment not found")
    if exp.status == StatusType.RUNNING:
        raise HTTPException(409, "Cannot modify a running experiment")

    if not session.get(Model, model_id):
        raise HTTPException(404, "Model not found")

    if model_id in exp.candidate_model_ids:
        raise HTTPException(400, "Model already in experiment")

    exp.candidate_model_ids = exp.candidate_model_ids + [model_id]
    if exp.status in (StatusType.COMPLETED, StatusType.FAILED):
        exp.status = StatusType.PENDING
    exp.updated_at = datetime.datetime.now(datetime.timezone.utc)
    session.add(exp)
    session.commit()
    session.refresh(exp)
    return _to_read(exp, session)


@router.get("/{experiment_id}/runs/{run_id}/answers")
def download_answers(experiment_id: int, run_id: int, session: SessionDep, current_user: CurrentUserDep):
    exp = session.get(Experiment, experiment_id)
    if not exp or exp.user_id != current_user.id:
        raise HTTPException(404, "Experiment not found")
    run = session.get(ExperimentRun, run_id)
    if not run or run.experiment_id != experiment_id:
        raise HTTPException(404, "Run not found")
    if not run.answers_path or not Path(run.answers_path).exists():
        raise HTTPException(404, "Answers file not available")
    return FileResponse(run.answers_path, media_type="text/csv", filename=f"answers_run_{run_id}.csv")


@router.get("/{experiment_id}/runs/{run_id}/metrics")
def download_metrics(experiment_id: int, run_id: int, session: SessionDep, current_user: CurrentUserDep):
    exp = session.get(Experiment, experiment_id)
    if not exp or exp.user_id != current_user.id:
        raise HTTPException(404, "Experiment not found")
    run = session.get(ExperimentRun, run_id)
    if not run or run.experiment_id != experiment_id:
        raise HTTPException(404, "Run not found")
    if not run.metrics_path or not Path(run.metrics_path).exists():
        raise HTTPException(404, "Metrics file not available")
    return FileResponse(run.metrics_path, media_type="application/json", filename=f"metrics_run_{run_id}.json")


@router.post("/{experiment_id}/analyze")
def analyze_experiment(
    experiment_id: int,
    payload: AnalyzeRequest,
    session: SessionDep,
    current_user: CurrentUserDep,
):
    exp = session.get(Experiment, experiment_id)
    if not exp or exp.user_id != current_user.id:
        raise HTTPException(404, "Experiment not found")
    if exp.status != StatusType.COMPLETED:
        raise HTTPException(400, "Experiment must be completed before analyzing")
    if payload.model_id not in exp.candidate_model_ids:
        raise HTTPException(400, "Model must be one of the experiment's candidate models")

    from db_models.model import Model as ModelDB
    model = session.get(ModelDB, payload.model_id)
    if not model:
        raise HTTPException(404, "Model not found")

    completed_runs = session.exec(
        select(ExperimentRun).where(
            ExperimentRun.experiment_id == experiment_id,
            ExperimentRun.status == StatusType.COMPLETED,
        )
    ).all()
    if not completed_runs:
        raise HTTPException(400, "No completed runs to analyze")

    all_model_ids = list({r.model_id for r in completed_runs})
    model_names = {}
    for mid in all_model_ids:
        m = session.get(ModelDB, mid)
        if m:
            model_names[mid] = m.name

    dataset = session.get(Dataset, exp.dataset_id)
    dataset_name = dataset.name if dataset else f"Dataset #{exp.dataset_id}"
    judge_types = ", ".join(sorted({r.judge_type for r in completed_runs}))

    enriched_runs = [_run_to_read(r) for r in completed_runs]
    results_block = _build_results_block(enriched_runs, model_names)
    prompt = _ANALYSIS_PROMPT.format(
        experiment_name=exp.name,
        dataset_name=dataset_name,
        sample_size=exp.sample_size,
        judge_types=judge_types,
        model_results_block=results_block,
    )

    try:
        client = get_model_client(model)
        client.system_prompt = None
        resp = client.generate(prompt)
    except Exception as e:
        raise HTTPException(500, f"Model call failed: {e}") from e

    return {"analysis": resp.content}


@router.delete("/{experiment_id}/models/{model_id}", response_model=ExperimentRead)
def remove_model_from_experiment(experiment_id: int, model_id: int, session: SessionDep, current_user: CurrentUserDep):
    exp = session.get(Experiment, experiment_id)
    if not exp or exp.user_id != current_user.id:
        raise HTTPException(404, "Experiment not found")
    if exp.status == StatusType.RUNNING:
        raise HTTPException(409, "Cannot modify a running experiment")

    if model_id not in exp.candidate_model_ids:
        raise HTTPException(404, "Model not in experiment")

    if len(exp.candidate_model_ids) == 1:
        raise HTTPException(400, "Cannot remove the only model from an experiment")

    runs_to_delete = session.exec(
        select(ExperimentRun).where(
            ExperimentRun.experiment_id == exp.id,
            ExperimentRun.model_id == model_id,
        )
    ).all()
    for run in runs_to_delete:
        if run.answers_path:
            run_dir = Path(run.answers_path).parent
            if run_dir.exists():
                shutil.rmtree(run_dir, ignore_errors=True)
        session.delete(run)
    session.flush()

    exp.candidate_model_ids = [m for m in exp.candidate_model_ids if m != model_id]

    # Only consider runs for current candidate models (not orphaned runs from past edits)
    current_candidate_ids = set(exp.candidate_model_ids)
    all_remaining = session.exec(
        select(ExperimentRun).where(ExperimentRun.experiment_id == exp.id)
    ).all()
    remaining_runs = [r for r in all_remaining if r.model_id in current_candidate_ids]
    models_without_runs = any(
        not any(r.model_id == mid for r in remaining_runs)
        for mid in exp.candidate_model_ids
    )
    if not remaining_runs or models_without_runs:
        exp.status = StatusType.PENDING
    elif all(r.status == StatusType.COMPLETED for r in remaining_runs):
        exp.status = StatusType.COMPLETED
    elif all(r.status == StatusType.FAILED for r in remaining_runs):
        exp.status = StatusType.FAILED

    exp.updated_at = datetime.datetime.now(datetime.timezone.utc)
    session.add(exp)
    session.commit()
    session.refresh(exp)
    return _to_read(exp, session)
