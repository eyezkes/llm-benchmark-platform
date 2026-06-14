"""
Basic happy-path and negative smoke tests.

Covers:
  - Core API endpoints accessible after auth
  - JSONL dataset upload, map, patch, delete
  - Experiment create, patch, model add/remove, delete
  - Negative: wrong credentials, missing token, bad model/judge creation,
    unsupported file type, contains judge on MC dataset, sample_size overflow

Requires a running API server.

Run with:
    pytest tests/test_smoke.py
"""

from __future__ import annotations

import io
import csv
import json
import os
import sys
from pathlib import Path
from typing import Any

import requests


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

def _auth() -> str:
    resp = _req("POST", "/auth/register", json={"email": EMAIL, "password": PASSWORD})
    if resp.status_code == 400 and "already registered" in resp.text.lower():
        resp = _req("POST", "/auth/login", json={"email": EMAIL, "password": PASSWORD})
    if not resp.ok: raise RuntimeError(f"auth failed: {resp.text}")
    return resp.json()["access_token"]


# ═══════════════════════════════════════════════════════════════════════════════
# Happy path smoke
# ═══════════════════════════════════════════════════════════════════════════════

def test_smoke_happy_path() -> None:
    token = _auth()
    _ok("GET /auth/me",      _req("GET", "/auth/me",       headers=_hdr(token)), 200)
    _ok("GET /judge-models", _req("GET", "/judge-models/", headers=_hdr(token)), 200)
    _ok("GET /datasets",     _req("GET", "/datasets/",     headers=_hdr(token)), 200)
    _ok("GET /experiments",  _req("GET", "/experiments/",   headers=_hdr(token)), 200)

    # Upload JSONL dataset
    records = [
        {"prompt": "Name the largest ocean.", "answer": "Pacific Ocean", "category": "geography"},
        {"prompt": "What is 9 + 10?",         "answer": "19",            "category": "math"},
        {"prompt": "What gas do plants absorb?", "answer": "Carbon dioxide", "category": "science"},
    ]
    content = "\n".join(json.dumps(r) for r in records)
    ds = _ok("upload JSONL dataset", _req("POST", "/datasets/upload",
        data={"name": "smoke-open-jsonl", "dataset_type": "open_with_true",
              "description": "smoke test dataset"},
        files={"file": ("smoke.jsonl", io.BytesIO(content.encode()), "application/x-ndjson")},
        headers=_hdr(token)), 201)
    ds_id = ds["id"]

    _ok("GET dataset columns", _req("GET", f"/datasets/{ds_id}/columns", headers=_hdr(token)), 200)

    mapped = _ok("map dataset", _req("POST", f"/datasets/{ds_id}/map",
        json={"question": "prompt", "true_answer": "answer", "category": "category"},
        headers=_hdr(token)), 200)
    assert mapped["status"] == "ready" and mapped["number_of_questions"] == 3

    _ok("PATCH dataset", _req("PATCH", f"/datasets/{ds_id}",
        json={"name": "smoke-updated", "description": "updated"},
        headers=_hdr(token)), 200)

    # Experiment (only if models exist)
    models = _ok("list models", _req("GET", "/models/", headers=_hdr(token)), 200)
    if models:
        model_ids = [m["id"] for m in models[:2]]
        exp = _ok("create experiment", _req("POST", "/experiments/", json={
            "name": "Smoke contains experiment",
            "dataset_id": ds_id,
            "candidate_model_ids": model_ids,
            "judge_configs": [{"judge_type": "contains"}],
            "sample_size": 3, "seed": 101, "measure_k": 1,
        }, headers=_hdr(token)), 201)
        exp_id = exp["id"]

        _ok("GET experiment", _req("GET", f"/experiments/{exp_id}", headers=_hdr(token)), 200)
        _ok("PATCH experiment", _req("PATCH", f"/experiments/{exp_id}",
            json={"name": "Smoke updated", "seed": 202}, headers=_hdr(token)), 200)

        if len(model_ids) > 1:
            _ok("remove model", _req("DELETE", f"/experiments/{exp_id}/models/{model_ids[1]}", headers=_hdr(token)), 200)
            _ok("re-add model", _req("POST",   f"/experiments/{exp_id}/models/{model_ids[1]}", headers=_hdr(token)), 200)

        _ok("delete experiment", _req("DELETE", f"/experiments/{exp_id}", headers=_hdr(token)), 204)
    else:
        print("SKIP  experiment smoke (no candidate models)")

    _ok("delete dataset", _req("DELETE", f"/datasets/{ds_id}", headers=_hdr(token)), 204)


# ═══════════════════════════════════════════════════════════════════════════════
# Negative / expected-failure smoke
# ═══════════════════════════════════════════════════════════════════════════════

def test_smoke_expected_failures() -> None:
    token = _auth()

    # Wrong password
    r = _req("POST", "/auth/login", json={"email": EMAIL, "password": PASSWORD + "-wrong"})
    assert r.status_code == 401
    print("OK    wrong password -> 401")

    # No token
    r = _req("GET", "/auth/me")
    assert r.status_code in {401, 403}
    print("OK    no token -> 401/403")

    # Model without api_key or base_url
    r = _req("POST", "/models/", json={"name": "bad", "provider": "openrouter", "model_name": "openai/gpt-4.1"}, headers=_hdr(token))
    assert r.status_code >= 400
    print("OK    model without api_key/base_url rejected")

    # Score judge without score_min/score_max
    r = _req("POST", "/judge-models/", json={
        "name": "bad-judge", "provider": "openrouter", "model_name": "openai/gpt-4.1",
        "api_key": "fake", "mode": "score",
    }, headers=_hdr(token))
    assert r.status_code >= 400
    print("OK    score judge without score range rejected")

    # Unsupported file type
    r = _req("POST", "/datasets/upload",
        data={"name": "bad-file", "dataset_type": "open_with_true"},
        files={"file": ("bad.txt", io.BytesIO(b"not,csv"), "text/plain")},
        headers=_hdr(token))
    assert r.status_code >= 400
    print("OK    unsupported file type rejected")

    # Upload MC dataset and test contains-on-MC and sample_size overflow
    mc_rows = [
        ["q1", "Capital of France?", json.dumps(["A) Paris", "B) Rome"]), "A"],
        ["q2", "2 + 2?",             json.dumps(["A) 3",     "B) 4"]),    "B"],
    ]
    buf = io.StringIO()
    csv.writer(buf, lineterminator="\n").writerows([
        ["question_id", "question", "options", "true_answer"], *mc_rows
    ])
    mc_resp = _req("POST", "/datasets/upload",
        data={"name": "smoke-mc", "dataset_type": "mc_with_true"},
        files={"file": ("mc.csv", io.BytesIO(buf.getvalue().encode()), "text/csv")},
        headers=_hdr(token))
    mc_id = _ok("upload MC dataset", mc_resp, 201)["id"]
    _ok("map MC dataset", _req("POST", f"/datasets/{mc_id}/map",
        json={"question_id": "question_id", "question": "question",
              "options": "options", "true_answer": "true_answer"},
        headers=_hdr(token)), 200)

    models = _ok("list models for negative checks", _req("GET", "/models/", headers=_hdr(token)), 200)
    if models:
        mid = models[0]["id"]
        r = _req("POST", "/experiments/", json={"name": "bad-contains-mc", "dataset_id": mc_id,
            "candidate_model_ids": [mid], "judge_configs": [{"judge_type": "contains"}],
            "sample_size": 1, "seed": 1, "measure_k": 1}, headers=_hdr(token))
        assert r.status_code >= 400
        print("OK    contains judge on MC dataset rejected")

        r = _req("POST", "/experiments/", json={"name": "bad-sample-size", "dataset_id": mc_id,
            "candidate_model_ids": [mid], "judge_configs": [{"judge_type": "equals"}],
            "sample_size": 99, "seed": 1, "measure_k": 1}, headers=_hdr(token))
        assert r.status_code >= 400
        print("OK    sample_size > dataset question count rejected")
    else:
        print("SKIP  experiment negative checks (no candidate models)")

    _ok("cleanup MC dataset", _req("DELETE", f"/datasets/{mc_id}", headers=_hdr(token)), 204)
