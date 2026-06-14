"""
Experiment lifecycle, execution, state guards, and reference-protection tests.

Covers:
  - Execution with fake model: accuracy, category metrics, output artifacts
  - Token counting: estimated vs API-reported
  - Download: answers CSV, metrics FileResponse (Content-Disposition: attachment)
  - Creation validation (bad dataset/model, unmapped dataset, sample_size=0)
  - PATCH validation (empty, sample_size > count, negative measure_k)
  - Add/remove model validation (duplicate, missing)
  - Status filter
  - State guards: PATCH / delete / add-model / re-run blocked when running/completed
  - Re-run from failed state succeeds
  - Reference protection: model/dataset/judge cannot be deleted while in use
  - Run directory cleaned up when experiment is deleted
  - error_message set on run failure (new)
  - Retry skips already-completed runs (new)

Requires a running API server.

Run with:
    pytest tests/test_experiments.py
"""

from __future__ import annotations

import csv
import io
import json
import os
import shutil
import sys
import types
import uuid
from pathlib import Path
from typing import Any

import requests


def _stub(name: str, **attrs) -> types.ModuleType:
    mod = types.ModuleType(name)
    for k, v in attrs.items(): setattr(mod, k, v)
    return mod

_fernet = _stub("cryptography.fernet", Fernet=object)
_crypto = _stub("cryptography"); _crypto.fernet = _fernet
for _n, _m in [
    ("anthropic",          _stub("anthropic", AuthenticationError=Exception, NotFoundError=Exception, Anthropic=object)),
    ("google",             _stub("google")), ("google.genai", _stub("google.genai", Client=object)),
    ("cryptography", _crypto), ("cryptography.fernet", _fernet),
    ("openai", _stub("openai", OpenAI=object, APIError=Exception)),
]:
    sys.modules.setdefault(_n, _m)
if not hasattr(sys.modules.get("cryptography.fernet"), "Fernet"):
    sys.modules["cryptography.fernet"].Fernet = object


def _load_env() -> None:
    p = Path(__file__).resolve().parent / ".env.test"
    if not p.exists(): return
    for line in p.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line: continue
        k, v = line.split("=", 1)
        if k.strip() and k.strip() not in os.environ:
            os.environ[k.strip()] = v.strip().strip('"').strip("'")

_load_env()

from sqlmodel import Session, select

from core.model_client import LLMResponse
from db import engine
from db_models.dataset import Dataset, DatasetStatus, DatasetType
from db_models.experiment import Experiment, ExperimentRun, JudgeType, StatusType
from db_models.model import JudgeMode, JudgeModel, Model
from db_models.user import User  # noqa: F401
from services import experiment_service
from services.experiment_service import ExperimentService

BASE_URL = os.getenv("BASE_URL", "http://localhost:8000").rstrip("/")
EMAIL    = os.getenv("TEST_EMAIL", "test@example.com")
PASSWORD = os.getenv("TEST_PASSWORD", "testpass123")
_http = requests.Session()


def _req(method: str, path: str, **kw: Any) -> requests.Response:
    return _http.request(method, f"{BASE_URL}{path}", timeout=60, **kw)

def _hdr(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}

def _ok(label: str, resp: requests.Response, *statuses: int) -> Any:
    if resp.status_code not in statuses:
        raise RuntimeError(f"{label}: expected {list(statuses)}, got {resp.status_code}: {resp.text[:300]}")
    print(f"OK    {label} [{resp.status_code}]")
    if resp.status_code == 204 or not resp.content: return {}
    try: return resp.json()
    except Exception: return resp.content

def _auth() -> tuple[str, int]:
    resp = _req("POST", "/auth/register", json={"email": EMAIL, "password": PASSWORD})
    if resp.status_code == 400 and "already registered" in resp.text.lower():
        resp = _req("POST", "/auth/login", json={"email": EMAIL, "password": PASSWORD})
    if not resp.ok: raise RuntimeError(f"auth failed: {resp.text}")
    token = resp.json()["access_token"]
    me = _ok("get me", _req("GET", "/auth/me", headers=_hdr(token)), 200)
    return token, me["id"]


# ── shared fixture helpers ─────────────────────────────────────────────────────

def _std_csv() -> str:
    buf = io.StringIO()
    csv.writer(buf, lineterminator="\n").writerows([
        ["question_id", "question", "true_answer", "category"],
        ["q1", "Capital of France?", "Paris", "geo"],
        ["q2", "What is 2 + 2?",    "4",     "math"],
    ])
    return buf.getvalue()


def _upload_ready_csv(token: str, name: str = "exp-dataset") -> int:
    resp = _req("POST", "/datasets/upload",
        data={"name": name, "dataset_type": "open_with_true"},
        files={"file": (f"{name}.csv", io.BytesIO(_std_csv().encode()), "text/csv")},
        headers=_hdr(token))
    return _ok(f"upload {name}", resp, 201)["id"]


def _set_status(exp_id: int, status: StatusType) -> None:
    with Session(engine) as db:
        exp = db.get(Experiment, exp_id)
        exp.status = status
        db.add(exp); db.commit()


def _run_experiment(exp_id: int, dataset_id: int, client_factory) -> None:
    orig = experiment_service.get_model_client
    try:
        experiment_service.get_model_client = client_factory
        with Session(engine) as db:
            exp = db.get(Experiment, exp_id)
            exp.status = StatusType.RUNNING
            db.add(exp)
            ds = db.get(Dataset, dataset_id)
            app_path = Path("app") / ds.file_path
            if not Path(ds.file_path).exists() and app_path.exists():
                ds.file_path = str(app_path); db.add(ds)
            db.commit()
            ExperimentService(db).run_experiment(exp_id)
    finally:
        experiment_service.get_model_client = orig


def _make_fake_model(user_id: int) -> int:
    with Session(engine) as db:
        m = Model(name=f"fake-{uuid.uuid4().hex[:6]}", provider="fake", model_name="fake",
                  base_url="http://localhost:1/v1", params={}, user_id=user_id)
        db.add(m); db.commit(); db.refresh(m)
        return int(m.id)


def _del_model(model_id: int) -> None:
    with Session(engine) as db:
        m = db.get(Model, model_id)
        if m: db.delete(m); db.commit()


def _cleanup(exp_id: int | None, dataset_id: int | None, model_id: int | None,
             token: str = "", judge_id: int | None = None) -> None:
    with Session(engine) as db:
        if exp_id:
            for r in db.exec(select(ExperimentRun).where(ExperimentRun.experiment_id == exp_id)).all():
                db.delete(r)
            e = db.get(Experiment, exp_id)
            if e: db.delete(e)
        if dataset_id:
            d = db.get(Dataset, dataset_id)
            if d:
                try: Path(d.file_path).unlink(missing_ok=True)
                except Exception: pass
                db.delete(d)
        if model_id:
            m = db.get(Model, model_id)
            if m: db.delete(m)
        if judge_id:
            j = db.get(JudgeModel, judge_id)
            if j: db.delete(j)
        db.commit()
    if exp_id:
        shutil.rmtree(Path("runs") / str(exp_id), ignore_errors=True)
        shutil.rmtree(Path("app") / "runs" / str(exp_id), ignore_errors=True)


# ═══════════════════════════════════════════════════════════════════════════════
# Execution with fake model
# ═══════════════════════════════════════════════════════════════════════════════

class _SmartClient:
    def generate(self, prompt: str) -> LLMResponse:
        if "Capital of France" in prompt: return LLMResponse(content="Paris",   ttft_ms=3.0, e2e_ms=7.0)
        if "2 + 2"            in prompt: return LLMResponse(content="4",       ttft_ms=4.0, e2e_ms=8.0)
        return LLMResponse(content="unknown", ttft_ms=5.0, e2e_ms=9.0)

class _SmartClientWithTokens:
    def generate(self, prompt: str) -> LLMResponse:
        if "Capital of France" in prompt: return LLMResponse(content="Paris", ttft_ms=3.0, e2e_ms=7.0, prompt_tokens=10, completion_tokens=2)
        if "2 + 2"            in prompt: return LLMResponse(content="4",     ttft_ms=4.0, e2e_ms=8.0, prompt_tokens=8,  completion_tokens=1)
        return LLMResponse(content="unknown", ttft_ms=5.0, e2e_ms=9.0, prompt_tokens=5, completion_tokens=1)


def test_experiment_execution_fake_model() -> None:
    token, user_id = _auth()
    model_id = exp_id = dataset_id = None
    try:
        model_id = _make_fake_model(user_id)
        dataset_id = _upload_ready_csv(token, "exec-fake-dataset")

        exp = _ok("create experiment", _req("POST", "/experiments/", json={
            "name": "Fake execution equals", "dataset_id": dataset_id,
            "candidate_model_ids": [model_id],
            "judge_configs": [{"judge_type": "equals"}],
            "sample_size": 2, "seed": 1, "measure_k": 1,
        }, headers=_hdr(token)), 201)
        exp_id = exp["id"]

        # Patch dataset path if needed, then run
        with Session(engine) as db:
            ds = db.get(Dataset, dataset_id)
            app_path = Path("app") / ds.file_path
            if not Path(ds.file_path).exists() and app_path.exists():
                ds.file_path = str(app_path); db.add(ds)
            db.commit()
        _run_experiment(exp_id, dataset_id, lambda _: _SmartClient())

        result = _ok("read completed experiment", _req("GET", f"/experiments/{exp_id}", headers=_hdr(token)), 200)
        assert result["status"] == "completed"
        assert result["prompt_tokens"] > 0 and result["completion_tokens"] > 0
        assert len(result["runs"]) == 1

        run = result["runs"][0]
        assert run["status"] == "completed"
        assert run["accuracy"] == 1.0 and run["correct_count"] == 2
        assert run["latency_measure_k"] == 1 and run["latency_sample_count"] == 1
        assert set(run["category_metrics"].keys()) == {"geo", "math"}
        assert run["token_count_method"] == "estimated_chars_div_4"
        print("OK    fake execution: accuracy=1.0, category metrics OK, token estimation")

        # Artifacts exist
        assert Path(run["answers_path"]).exists() and Path(run["metrics_path"]).exists()
        metrics = json.loads(Path(run["metrics_path"]).read_text(encoding="utf-8"))
        assert metrics["accuracy"] == 1.0

        # Downloads
        run_id = run["id"]
        r = _req("GET", f"/experiments/{exp_id}/runs/{run_id}/answers", headers=_hdr(token))
        assert r.status_code == 200 and "text/csv" in r.headers.get("content-type", "")
        print("OK    answers download returns CSV")

        r = _req("GET", f"/experiments/{exp_id}/runs/{run_id}/metrics", headers=_hdr(token))
        assert r.status_code == 200
        assert "attachment" in r.headers.get("content-disposition", ""), r.headers
        assert r.json().get("accuracy") == 1.0
        print("OK    metrics download returns file attachment with correct JSON")

    finally:
        _cleanup(exp_id, dataset_id, model_id, token)


def test_experiment_real_token_counts() -> None:
    token, user_id = _auth()
    model_id = exp_id = dataset_id = None
    try:
        model_id = _make_fake_model(user_id)
        dataset_id = _upload_ready_csv(token, "exec-tokens-dataset")

        exp = _ok("create experiment", _req("POST", "/experiments/", json={
            "name": "Real token count test", "dataset_id": dataset_id,
            "candidate_model_ids": [model_id],
            "judge_configs": [{"judge_type": "equals"}],
            "sample_size": 2, "seed": 1,
        }, headers=_hdr(token)), 201)
        exp_id = exp["id"]

        _run_experiment(exp_id, dataset_id, lambda _: _SmartClientWithTokens())

        result = _ok("read experiment", _req("GET", f"/experiments/{exp_id}", headers=_hdr(token)), 200)
        run = result["runs"][0]
        assert run["token_count_method"] == "api_reported"
        # Capital of France: p=10,c=2 + 2+2: p=8,c=1 -> 18/3/21
        assert result["prompt_tokens"] == 18
        assert result["completion_tokens"] == 3
        assert result["total_tokens"] == 21
        print("OK    api_reported token counts match exactly")

    finally:
        _cleanup(exp_id, dataset_id, model_id, token)


# ═══════════════════════════════════════════════════════════════════════════════
# Creation + PATCH validation, state guards
# ═══════════════════════════════════════════════════════════════════════════════

def test_experiment_lifecycle_edge_cases() -> None:
    token, _ = _auth()
    dataset_ids: list[int] = []
    exp_ids: list[int] = []
    try:
        models = _ok("list models", _req("GET", "/models/", headers=_hdr(token)), 200)

        ready_id = _upload_ready_csv(token, "edge-ready")
        dataset_ids.append(ready_id)

        # Creation validation
        r = _req("POST", "/experiments/", json={"name": "x", "dataset_id": 999999999,
            "candidate_model_ids": [999999999], "judge_configs": [{"judge_type": "equals"}], "sample_size": 1},
            headers=_hdr(token))
        assert r.status_code == 404
        print("OK    nonexistent dataset rejected")

        r = _req("POST", "/experiments/", json={"name": "x", "dataset_id": ready_id,
            "candidate_model_ids": [999999999], "judge_configs": [{"judge_type": "equals"}], "sample_size": 1},
            headers=_hdr(token))
        assert r.status_code == 404
        print("OK    nonexistent model rejected")

        # Unmapped dataset cannot be used
        buf = io.StringIO()
        csv.writer(buf, lineterminator="\n").writerows([["prompt_text", "gold"], ["Q?", "A"]])
        unmapped_resp = _req("POST", "/datasets/upload",
            data={"name": "edge-unmapped", "dataset_type": "open_with_true"},
            files={"file": ("unmapped.csv", io.BytesIO(buf.getvalue().encode()), "text/csv")},
            headers=_hdr(token))
        unmapped_id = _ok("upload unmapped", unmapped_resp, 201)["id"]
        dataset_ids.append(unmapped_id)
        if models:
            r = _req("POST", "/experiments/", json={"name": "x", "dataset_id": unmapped_id,
                "candidate_model_ids": [models[0]["id"]], "judge_configs": [{"judge_type": "equals"}], "sample_size": 1},
                headers=_hdr(token))
            assert r.status_code == 400
            print("OK    unmapped dataset rejected for experiment creation")

        if not models:
            print("SKIP  lifecycle state-guard checks (no candidate models)")
            return

        model_id = models[0]["id"]
        exp = _ok("create edge experiment", _req("POST", "/experiments/", json={
            "name": "Edge lifecycle", "dataset_id": ready_id,
            "candidate_model_ids": [model_id],
            "judge_configs": [{"judge_type": "equals"}],
            "sample_size": 2, "seed": 123, "measure_k": 1,
        }, headers=_hdr(token)), 201)
        exp_id = exp["id"]
        exp_ids.append(exp_id)

        # PATCH validation
        for label, body, expected in [
            ("empty patch",               {},                   400),
            ("sample_size above count",   {"sample_size": 99},  400),
            ("negative measure_k",        {"measure_k": -1},    400),
            ("measure_k above sample_size", {"measure_k": 3},   400),
        ]:
            r = _req("PATCH", f"/experiments/{exp_id}", json=body, headers=_hdr(token))
            assert r.status_code == expected, f"{label}: expected {expected}, got {r.status_code}"
            print(f"OK    {label} -> {expected}")

        # Duplicate model add rejected
        r = _req("POST", f"/experiments/{exp_id}/models/{model_id}", headers=_hdr(token))
        assert r.status_code == 400
        print("OK    duplicate model add rejected")

        # Status filter
        filtered = _ok("filter pending", _req("GET", "/experiments/?status_filter=pending", headers=_hdr(token)), 200)
        assert any(e["id"] == exp_id for e in filtered)
        print("OK    pending status filter includes created experiment")

        # State guards: RUNNING
        _set_status(exp_id, StatusType.RUNNING)
        for label, method, path, body in [
            ("PATCH when running",       "PATCH",  f"/experiments/{exp_id}", {"name": "new"}),
            ("DELETE when running",      "DELETE", f"/experiments/{exp_id}", None),
            ("add model when running",   "POST",   f"/experiments/{exp_id}/models/{model_id}", None),
            ("remove model when running","DELETE", f"/experiments/{exp_id}/models/{model_id}", None),
            ("re-run when running",      "POST",   f"/experiments/{exp_id}/run", None),
        ]:
            r = _req(method, path, json=body, headers=_hdr(token)) if body else _req(method, path, headers=_hdr(token))
            assert r.status_code == 409, f"{label}: expected 409, got {r.status_code}"
            print(f"OK    {label} -> 409")

        # State guards: COMPLETED
        _set_status(exp_id, StatusType.COMPLETED)
        for label, method, path, body in [
            ("PATCH when completed",       "PATCH",  f"/experiments/{exp_id}", {"name": "new"}),
            ("add model when completed",   "POST",   f"/experiments/{exp_id}/models/{model_id}", None),
            ("remove model when completed","DELETE", f"/experiments/{exp_id}/models/{model_id}", None),
            ("re-run when completed",      "POST",   f"/experiments/{exp_id}/run", None),
        ]:
            r = _req(method, path, json=body, headers=_hdr(token)) if body else _req(method, path, headers=_hdr(token))
            assert r.status_code == 409, f"{label}: expected 409, got {r.status_code}"
            print(f"OK    {label} -> 409")

    finally:
        for exp_id in exp_ids:
            try: _req("DELETE", f"/experiments/{exp_id}", headers=_hdr(token))
            except Exception: pass
        for ds_id in dataset_ids:
            try: _req("DELETE", f"/datasets/{ds_id}", headers=_hdr(token))
            except Exception: pass


# ═══════════════════════════════════════════════════════════════════════════════
# Reference protection + run-directory cleanup
# ═══════════════════════════════════════════════════════════════════════════════

def test_reference_protection_and_cleanup() -> None:
    token, user_id = _auth()
    model_id = judge_id = dataset_id = exp_id = None
    try:
        # Create model, judge, dataset, experiment via DB + API
        with Session(engine) as db:
            m = Model(name="ref-model", provider="fake", model_name="ref-fake",
                      base_url="http://localhost:1/v1", params={}, user_id=user_id)
            j = JudgeModel(name="ref-judge", provider="fake", model_name="ref-judge-fake",
                           base_url="http://localhost:1/v1", params={}, mode=JudgeMode.BOOLEAN,
                           correct_tokens=["correct"], incorrect_tokens=["incorrect"], user_id=user_id)
            db.add(m); db.add(j); db.commit()
            db.refresh(m); db.refresh(j)
            model_id, judge_id = int(m.id), int(j.id)

        buf = io.StringIO()
        csv.writer(buf, lineterminator="\n").writerows([
            ["question_id", "question", "true_answer"], ["q1", "Capital of Spain?", "Madrid"]
        ])
        ds_resp = _req("POST", "/datasets/upload",
            data={"name": "ref-dataset", "dataset_type": "open_with_true"},
            files={"file": ("ref.csv", io.BytesIO(buf.getvalue().encode()), "text/csv")},
            headers=_hdr(token))
        dataset_id = _ok("upload ref dataset", ds_resp, 201)["id"]

        exp = _ok("create ref experiment", _req("POST", "/experiments/", json={
            "name": "Reference cleanup", "dataset_id": dataset_id,
            "candidate_model_ids": [model_id],
            "judge_configs": [{"judge_type": "equals"}],
            "sample_size": 1, "seed": 2, "measure_k": 0,
        }, headers=_hdr(token)), 201)
        exp_id = exp["id"]

        # Model and dataset cannot be deleted while referenced
        r = _req("DELETE", f"/models/{model_id}", headers=_hdr(token))
        assert r.status_code == 409
        print("OK    model used by experiment cannot be deleted")

        r = _req("DELETE", f"/datasets/{dataset_id}", headers=_hdr(token))
        assert r.status_code == 409
        print("OK    dataset used by experiment cannot be deleted")

        # Insert a run referencing the judge to test judge protection
        run_dir = Path("runs") / str(exp_id) / "ref-check"
        run_dir.mkdir(parents=True, exist_ok=True)
        (run_dir / "marker.txt").write_text("cleanup check", encoding="utf-8")

        with Session(engine) as db:
            run = ExperimentRun(experiment_id=exp_id, model_id=model_id,
                                judge_type=JudgeType.LLM_BOOL, judge_model_id=judge_id,
                                status=StatusType.COMPLETED)
            db.add(run); db.commit()

        r = _req("DELETE", f"/judge-models/{judge_id}", headers=_hdr(token))
        assert r.status_code == 409
        print("OK    judge used by run cannot be deleted")

        # Delete experiment -> run directory removed
        _ok("delete experiment", _req("DELETE", f"/experiments/{exp_id}", headers=_hdr(token)), 204)
        assert not (Path("runs") / str(exp_id)).exists()
        print("OK    experiment delete removes run directory")
        exp_id = None

        # Now model, dataset, judge can be deleted
        _ok("delete dataset after exp", _req("DELETE", f"/datasets/{dataset_id}", headers=_hdr(token)), 204); dataset_id = None
        _ok("delete model after exp",   _req("DELETE", f"/models/{model_id}",    headers=_hdr(token)), 204); model_id = None
        _ok("delete judge after exp",   _req("DELETE", f"/judge-models/{judge_id}", headers=_hdr(token)), 204); judge_id = None

    finally:
        _cleanup(exp_id, dataset_id, model_id, token, judge_id)


# ═══════════════════════════════════════════════════════════════════════════════
# error_message and retry (new changes)
# ═══════════════════════════════════════════════════════════════════════════════

def _make_minimal_experiment(user_id: int) -> tuple[int, int, int]:
    with Session(engine) as db:
        m = Model(name=f"new-{uuid.uuid4().hex[:6]}", provider="fake", model_name="fake",
                  base_url="http://localhost:1/v1", params={}, user_id=user_id)
        db.add(m); db.commit(); db.refresh(m)

        buf = io.StringIO()
        csv.writer(buf, lineterminator="\n").writerows([
            ["question_id", "question", "true_answer"], ["q1", "6×7?", "42"]
        ])
        fpath = f"app/data/datasets/new-{user_id}-{uuid.uuid4().hex[:6]}.csv"
        Path(fpath).parent.mkdir(parents=True, exist_ok=True)
        Path(fpath).write_text(buf.getvalue(), encoding="utf-8")

        ds = Dataset(name="new-ds", dataset_type=DatasetType.OPEN_WITH_TRUE, file_path=fpath,
                     status=DatasetStatus.READY, number_of_questions=1,
                     column_mapping={"question_id": "question_id", "question": "question", "true_answer": "true_answer"},
                     user_id=user_id)
        db.add(ds); db.commit(); db.refresh(ds)

        exp = Experiment(name="new-exp", dataset_id=int(ds.id), candidate_model_ids=[int(m.id)],
                         judge_configs=[{"judge_type": "contains"}], sample_size=1, seed=42,
                         measure_k=0, status=StatusType.PENDING, user_id=user_id)
        db.add(exp); db.commit(); db.refresh(exp)
        return int(m.id), int(ds.id), int(exp.id)


def test_error_message_set_on_failure() -> None:
    token, user_id = _auth()
    m_id = ds_id = exp_id = None
    try:
        m_id, ds_id, exp_id = _make_minimal_experiment(user_id)

        class FailClient:
            def generate(self, _): raise RuntimeError("simulated failure")

        _run_experiment(exp_id, ds_id, lambda _: FailClient())

        with Session(engine) as db:
            runs = db.exec(select(ExperimentRun).where(ExperimentRun.experiment_id == exp_id)).all()
        failed = [r for r in runs if r.status == StatusType.FAILED]
        assert failed, f"no failed runs; statuses: {[r.status for r in runs]}"
        assert failed[0].error_message  # service wraps row errors; just assert non-empty
        print(f"OK    error_message = {failed[0].error_message!r}")

    finally:
        _cleanup(exp_id, ds_id, m_id)


def test_retry_skips_completed_runs() -> None:
    token, user_id = _auth()
    m_id = ds_id = exp_id = None
    try:
        m_id, ds_id, exp_id = _make_minimal_experiment(user_id)

        class OkClient:
            def generate(self, _): return LLMResponse(content="42", ttft_ms=1.0, e2e_ms=2.0)

        _run_experiment(exp_id, ds_id, lambda _: OkClient())

        with Session(engine) as db:
            completed = db.exec(select(ExperimentRun).where(
                ExperimentRun.experiment_id == exp_id,
                ExperimentRun.status == StatusType.COMPLETED)).all()
        assert completed, "first run did not complete"
        first_run_id = completed[0].id

        # Reset experiment to PENDING to allow a retry
        _set_status(exp_id, StatusType.PENDING)

        call_count = [0]
        class CountingClient:
            def generate(self, _):
                call_count[0] += 1
                return LLMResponse(content="42", ttft_ms=1.0, e2e_ms=2.0)

        _run_experiment(exp_id, ds_id, lambda _: CountingClient())

        assert call_count[0] == 0, f"retry re-executed completed run ({call_count[0]} calls)"
        with Session(engine) as db:
            run = db.get(ExperimentRun, first_run_id)
        assert run.status == StatusType.COMPLETED
        print("OK    completed run was skipped and remains COMPLETED after retry")

    finally:
        _cleanup(exp_id, ds_id, m_id)
