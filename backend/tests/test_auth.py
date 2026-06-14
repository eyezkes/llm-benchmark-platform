"""
Auth, ownership, and model/judge CRUD tests.

Covers:
  - JWT register / login / refresh / logout lifecycle
  - Password change (wrong old, too-short, new minimum of 8 chars)
  - Dataset and experiment cross-user isolation
  - Model and judge model CRUD, PATCH, and cross-user isolation

Requires a running API server.

Run with:
    pytest tests/test_auth.py
"""

from __future__ import annotations

import csv
import io
import json
import os
import sys
import uuid
from pathlib import Path
from typing import Any

import requests


def _load_env() -> None:
    p = Path(__file__).resolve().parent / ".env.test"
    if not p.exists():
        return
    for line in p.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        k, v = line.split("=", 1)
        if k.strip() and k.strip() not in os.environ:
            os.environ[k.strip()] = v.strip().strip('"').strip("'")


_load_env()

# DB imports for direct fixture creation
import types as _types
def _stub(name: str, **attrs) -> _types.ModuleType:
    mod = _types.ModuleType(name)
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

from sqlmodel import Session
from db import engine
from db_models.dataset import Dataset, DatasetStatus, DatasetType
from db_models.experiment import Experiment, StatusType
from db_models.model import JudgeMode, JudgeModel, Model
from db_models.user import User  # noqa: F401

BASE_URL = os.getenv("BASE_URL", "http://localhost:8000").rstrip("/")
_http = requests.Session()


def _req(method: str, path: str, **kw: Any) -> requests.Response:
    return _http.request(method, f"{BASE_URL}{path}", timeout=60, **kw)

def _hdr(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}

def _ok(label: str, resp: requests.Response, *statuses: int) -> Any:
    if resp.status_code not in statuses:
        raise RuntimeError(f"{label}: expected {list(statuses)}, got {resp.status_code}: {resp.text[:300]}")
    print(f"OK    {label} [{resp.status_code}]")
    if resp.status_code == 204 or not resp.content:
        return {}
    try: return resp.json()
    except Exception: return resp.content

def _register(email: str, password: str) -> tuple[str, str, int]:
    """Returns (access_token, refresh_token, user_id)."""
    resp = _req("POST", "/auth/register", json={"email": email, "password": password})
    if not resp.ok:
        raise RuntimeError(f"register failed: {resp.text}")
    data = resp.json()
    me = _ok("get me", _req("GET", "/auth/me", headers=_hdr(data["access_token"])), 200)
    return data["access_token"], data.get("refresh_token", ""), me["id"]


# ═══════════════════════════════════════════════════════════════════════════════
# JWT lifecycle + password change
# ═══════════════════════════════════════════════════════════════════════════════

def test_auth_jwt_and_password() -> None:
    suffix = uuid.uuid4().hex[:8]
    old_pass = "oldpassword1"
    new_pass = "newpassword2"
    token, refresh, _ = _register(f"jwt-{suffix}@x.com", old_pass)

    # refresh works
    refreshed = _ok("refresh token", _req("POST", "/auth/refresh", json={"refresh_token": refresh}), 200)
    _ok("refreshed token auth", _req("GET", "/auth/me", headers=_hdr(refreshed["access_token"])), 200)

    # access token is rejected by refresh endpoint
    r = _req("POST", "/auth/refresh", json={"refresh_token": token})
    assert r.status_code == 401, f"access token should be rejected by refresh: {r.status_code}"
    print("OK    access token rejected by refresh endpoint")

    # malformed token rejected
    r = _req("GET", "/auth/me", headers=_hdr("not-a-valid-jwt"))
    assert r.status_code in {401, 403}
    print("OK    malformed token rejected")

    # wrong old password rejected
    r = _req("POST", "/auth/change-password", json={"old_password": "wrong", "new_password": new_pass}, headers=_hdr(token))
    assert r.status_code == 400
    print("OK    wrong old password rejected")

    # 3-char new password rejected
    r = _req("POST", "/auth/change-password", json={"old_password": old_pass, "new_password": "abc"}, headers=_hdr(token))
    assert r.status_code == 400
    print("OK    3-char password rejected")

    # 7-char new password rejected (below new minimum of 8)
    r = _req("POST", "/auth/change-password", json={"old_password": old_pass, "new_password": "abcdefg"}, headers=_hdr(token))
    assert r.status_code == 400
    print("OK    7-char password rejected (min is 8)")

    # 8-char password accepted
    _ok("change password to 8-char", _req("POST", "/auth/change-password",
        json={"old_password": old_pass, "new_password": "abcdefgh"}, headers=_hdr(token)), 200)

    # old password no longer works
    r = _req("POST", "/auth/login", json={"email": f"jwt-{suffix}@x.com", "password": old_pass})
    assert r.status_code == 401
    print("OK    old password rejected after change")

    # new password works
    _ok("login with new password", _req("POST", "/auth/login",
        json={"email": f"jwt-{suffix}@x.com", "password": "abcdefgh"}), 200)

    # logout
    _ok("logout", _req("POST", "/auth/logout", headers=_hdr(token)), 200)


# ═══════════════════════════════════════════════════════════════════════════════
# Dataset + experiment cross-user isolation
# ═══════════════════════════════════════════════════════════════════════════════

def _upload_ready_dataset(token: str) -> int:
    records = [{"prompt": "Who wrote Hamlet?", "answer": "Shakespeare"}]
    content = "\n".join(json.dumps(r) for r in records)
    resp = _req("POST", "/datasets/upload",
        data={"name": "iso-dataset", "dataset_type": "open_with_true"},
        files={"file": ("iso.jsonl", io.BytesIO(content.encode()), "application/x-ndjson")},
        headers=_hdr(token))
    ds = _ok("upload dataset", resp, 201)
    _ok("map dataset", _req("POST", f"/datasets/{ds['id']}/map",
        json={"question": "prompt", "true_answer": "answer"}, headers=_hdr(token)), 200)
    return ds["id"]


def _make_exp_fixtures(user_id: int) -> tuple[int, int, int]:
    with Session(engine) as db:
        model = Model(name="iso-model", provider="fake", model_name="fake",
                      base_url="http://localhost:1/v1", params={}, user_id=user_id)
        db.add(model); db.commit(); db.refresh(model)

        buf = io.StringIO()
        csv.writer(buf, lineterminator="\n").writerows([
            ["question_id", "question", "true_answer"], ["q1", "1+1?", "2"]
        ])
        fpath = f"app/data/datasets/iso-{user_id}.csv"
        Path(fpath).parent.mkdir(parents=True, exist_ok=True)
        Path(fpath).write_text(buf.getvalue(), encoding="utf-8")

        ds = Dataset(name="iso-ds", dataset_type=DatasetType.OPEN_WITH_TRUE, file_path=fpath,
                     status=DatasetStatus.READY, number_of_questions=1,
                     column_mapping={"question_id": "question_id", "question": "question", "true_answer": "true_answer"},
                     user_id=user_id)
        db.add(ds); db.commit(); db.refresh(ds)

        exp = Experiment(name="iso-exp", dataset_id=int(ds.id), candidate_model_ids=[int(model.id)],
                         judge_configs=[{"judge_type": "equals"}], sample_size=1, seed=1,
                         measure_k=0, status=StatusType.PENDING, user_id=user_id)
        db.add(exp); db.commit(); db.refresh(exp)
        return int(model.id), int(ds.id), int(exp.id)


def _cleanup_exp_fixtures(model_id, dataset_id, exp_id) -> None:
    with Session(engine) as db:
        if exp_id:
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
        db.commit()


def test_cross_user_isolation() -> None:
    suffix = uuid.uuid4().hex[:8]
    token_a, _, user_a = _register(f"iso-a-{suffix}@x.com", "isopass99")
    token_b, _, _     = _register(f"iso-b-{suffix}@x.com", "isopass99")

    ds_id = m_id = exp_id = None
    try:
        # Dataset isolation
        ds_id = _upload_ready_dataset(token_a)
        for label, resp in [
            ("B read dataset",   _req("GET",    f"/datasets/{ds_id}", headers=_hdr(token_b))),
            ("B patch dataset",  _req("PATCH",  f"/datasets/{ds_id}", json={"name": "x"}, headers=_hdr(token_b))),
            ("B delete dataset", _req("DELETE", f"/datasets/{ds_id}", headers=_hdr(token_b))),
        ]:
            assert resp.status_code == 404, f"{label}: expected 404, got {resp.status_code}"
            print(f"OK    {label} -> 404")
        _ok("A can still read dataset", _req("GET", f"/datasets/{ds_id}", headers=_hdr(token_a)), 200)
        _req("DELETE", f"/datasets/{ds_id}", headers=_hdr(token_a)); ds_id = None

        # Experiment isolation
        m_id, _, exp_id = _make_exp_fixtures(user_a)
        for label, resp in [
            ("B read exp",   _req("GET",    f"/experiments/{exp_id}", headers=_hdr(token_b))),
            ("B patch exp",  _req("PATCH",  f"/experiments/{exp_id}", json={"name": "x"}, headers=_hdr(token_b))),
            ("B delete exp", _req("DELETE", f"/experiments/{exp_id}", headers=_hdr(token_b))),
            ("B run exp",    _req("POST",   f"/experiments/{exp_id}/run", headers=_hdr(token_b))),
        ]:
            assert resp.status_code == 404, f"{label}: expected 404, got {resp.status_code}"
            print(f"OK    {label} -> 404")

        exps_b = _ok("B lists experiments", _req("GET", "/experiments/", headers=_hdr(token_b)), 200)
        assert not any(e["id"] == exp_id for e in exps_b), "B's list leaks A's experiment"
        print("OK    B's experiment list does not contain A's experiment")
    finally:
        if ds_id: _req("DELETE", f"/datasets/{ds_id}", headers=_hdr(token_a))
        _cleanup_exp_fixtures(m_id, None, exp_id)
        if m_id:
            with Session(engine) as db:
                m = db.get(Model, m_id)
                if m: db.delete(m); db.commit()


# ═══════════════════════════════════════════════════════════════════════════════
# Model + judge model CRUD, PATCH, and cross-user isolation
# ═══════════════════════════════════════════════════════════════════════════════

def _create_model_and_judge(user_id: int) -> tuple[int, int]:
    with Session(engine) as db:
        model = Model(name="crud-model", provider="fake", model_name="fake-v1",
                      base_url="http://localhost:1/v1", params={"temperature": 0}, user_id=user_id)
        judge = JudgeModel(name="crud-judge", provider="fake", model_name="fake-judge",
                           base_url="http://localhost:1/v1", params={}, mode=JudgeMode.BOOLEAN,
                           correct_tokens=["correct"], incorrect_tokens=["incorrect"], user_id=user_id)
        db.add(model); db.add(judge); db.commit()
        db.refresh(model); db.refresh(judge)
        return int(model.id), int(judge.id)


def test_model_judge_crud_and_isolation() -> None:
    suffix = uuid.uuid4().hex[:8]
    token_a, _, user_a = _register(f"crud-a-{suffix}@x.com", "crudpass99")
    token_b, _, _      = _register(f"crud-b-{suffix}@x.com", "crudpass99")

    m_id = j_id = None
    try:
        m_id, j_id = _create_model_and_judge(user_a)

        # Model PATCH happy path
        patched = _ok("owner patches model", _req("PATCH", f"/models/{m_id}",
            json={"name": "crud-model-v2", "model_name": "fake-v2", "params": {"temperature": 1}},
            headers=_hdr(token_a)), 200)
        assert patched["name"] == "crud-model-v2"
        confirmed = _ok("model GET confirms PATCH", _req("GET", f"/models/{m_id}", headers=_hdr(token_a)), 200)
        assert confirmed["model_name"] == "fake-v2"

        # Judge model PATCH happy path
        pj = _ok("owner patches judge", _req("PATCH", f"/judge-models/{j_id}",
            json={"name": "crud-judge-v2", "correct_tokens": ["yes", "correct"]},
            headers=_hdr(token_a)), 200)
        assert pj["name"] == "crud-judge-v2" and "yes" in pj["correct_tokens"]

        # Cross-user isolation: model
        for label, resp in [
            ("B read model",   _req("GET",    f"/models/{m_id}", headers=_hdr(token_b))),
            ("B patch model",  _req("PATCH",  f"/models/{m_id}", json={"name": "x"}, headers=_hdr(token_b))),
            ("B delete model", _req("DELETE", f"/models/{m_id}", headers=_hdr(token_b))),
        ]:
            assert resp.status_code == 404, f"{label}: expected 404, got {resp.status_code}"
            print(f"OK    {label} -> 404")

        # Cross-user isolation: judge
        for label, resp in [
            ("B read judge",   _req("GET",    f"/judge-models/{j_id}", headers=_hdr(token_b))),
            ("B patch judge",  _req("PATCH",  f"/judge-models/{j_id}", json={"name": "x"}, headers=_hdr(token_b))),
            ("B delete judge", _req("DELETE", f"/judge-models/{j_id}", headers=_hdr(token_b))),
        ]:
            assert resp.status_code == 404, f"{label}: expected 404, got {resp.status_code}"
            print(f"OK    {label} -> 404")

        _ok("owner deletes model", _req("DELETE", f"/models/{m_id}", headers=_hdr(token_a)), 204); m_id = None
        _ok("owner deletes judge", _req("DELETE", f"/judge-models/{j_id}", headers=_hdr(token_a)), 204); j_id = None
    finally:
        with Session(engine) as db:
            if m_id:
                m = db.get(Model, m_id)
                if m: db.delete(m)
            if j_id:
                j = db.get(JudgeModel, j_id)
                if j: db.delete(j)
            db.commit()
