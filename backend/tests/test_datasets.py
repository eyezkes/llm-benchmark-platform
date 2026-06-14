"""
Dataset upload, mapping edge cases, and download tests.

Covers:
  - Standard CSV auto-mapping
  - Manual mapping edge cases (missing columns, unknown columns, empty questions)
  - MC options validation
  - JSONL list-options normalization
  - Invalid dataset_type rejection
  - Delete and 404 behaviour
  - Download endpoint: CSV, JSONL -> CSV, cross-user isolation

Requires a running API server.

Run with:
    pytest tests/test_datasets.py
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
    if not resp.ok:
        raise RuntimeError(f"auth failed: {resp.text}")
    return resp.json()["access_token"]


def _upload(token: str, *, name: str, dataset_type: str, content: str,
            filename: str, content_type: str) -> dict:
    return _ok(f"upload {name}", _req("POST", "/datasets/upload",
        data={"name": name, "dataset_type": dataset_type},
        files={"file": (filename, io.BytesIO(content.encode()), content_type)},
        headers=_hdr(token)), 201)


def _csv(*rows) -> str:
    buf = io.StringIO()
    csv.writer(buf, lineterminator="\n").writerows(rows)
    return buf.getvalue()


def _del(token: str, ds_id: int) -> None:
    try: _req("DELETE", f"/datasets/{ds_id}", headers=_hdr(token))
    except Exception: pass


# ═══════════════════════════════════════════════════════════════════════════════
# Mapping edge cases
# ═══════════════════════════════════════════════════════════════════════════════

def test_dataset_mapping_edge_cases() -> None:
    token = _auth()
    created: list[int] = []
    try:
        # Standard columns -> auto-mapped on upload
        ds = _upload(token, name="edge-auto", dataset_type="open_with_true",
                     content=_csv(["question_id", "question", "true_answer", "category"],
                                  ["q1", "Capital?", "Rome", "geo"], ["q2", "2+3?", "5", "math"]),
                     filename="auto.csv", content_type="text/csv")
        created.append(ds["id"])
        assert ds["status"] == "ready" and ds["number_of_questions"] == 2
        print("OK    standard CSV auto-maps on upload")

        # Non-standard columns -> requires manual mapping
        manual_ds = _upload(token, name="edge-manual", dataset_type="open_with_true",
                            content=_csv(["prompt_text", "gold"], ["One?", "1"], ["Two?", "2"]),
                            filename="manual.csv", content_type="text/csv")
        created.append(manual_ds["id"])
        assert manual_ds["status"] == "uploaded"

        r = _req("POST", f"/datasets/{manual_ds['id']}/map",
                 json={"question": "prompt_text"}, headers=_hdr(token))
        assert r.status_code == 400
        print("OK    mapping without true_answer rejected")

        r = _req("POST", f"/datasets/{manual_ds['id']}/map",
                 json={"question": "prompt_text", "true_answer": "not_a_column"}, headers=_hdr(token))
        assert r.status_code == 400
        print("OK    mapping unknown column rejected")

        mapped = _ok("manual mapping succeeds", _req("POST", f"/datasets/{manual_ds['id']}/map",
            json={"question": "prompt_text", "true_answer": "gold"}, headers=_hdr(token)), 200)
        assert mapped["column_mapping"].get("question_id") == "_auto_question_id"
        print("OK    auto question_id generated for datasets without question_id")

        # Empty questions rejected
        empty_ds = _upload(token, name="edge-empty", dataset_type="open_with_true",
                           content=_csv(["question", "true_answer"], ["   ", "A"], ["", "B"]),
                           filename="empty.csv", content_type="text/csv")
        created.append(empty_ds["id"])
        r = _req("POST", f"/datasets/{empty_ds['id']}/map",
                 json={"question": "question", "true_answer": "true_answer"}, headers=_hdr(token))
        assert r.status_code == 400
        print("OK    mapping with all-empty question column rejected")

        # MC options must be JSON arrays
        bad_mc = _upload(token, name="edge-bad-mc", dataset_type="mc_with_true",
                         content=_csv(["question", "options", "true_answer"],
                                      ["Choose A", "A) one; B) two", "A"]),
                         filename="bad-mc.csv", content_type="text/csv")
        created.append(bad_mc["id"])
        r = _req("POST", f"/datasets/{bad_mc['id']}/map",
                 json={"question": "question", "options": "options", "true_answer": "true_answer"},
                 headers=_hdr(token))
        assert r.status_code == 400
        print("OK    MC options must be JSON array strings")

        # JSONL with list options -> auto-normalize and map
        mc_jsonl = "\n".join(json.dumps(r) for r in [
            {"question": "Pick red", "options": ["A) red", "B) blue"], "true_answer": "A"},
            {"question": "Pick 4",   "options": ["A) 3",   "B) 4"],   "true_answer": "B"},
        ])
        mc_ds = _upload(token, name="edge-mc-jsonl", dataset_type="mc_with_true",
                        content=mc_jsonl, filename="mc.jsonl", content_type="application/x-ndjson")
        created.append(mc_ds["id"])
        assert mc_ds["status"] == "ready" and mc_ds["number_of_questions"] == 2
        print("OK    JSONL list options normalize and auto-map")

        # Invalid dataset_type
        r = _req("POST", "/datasets/upload",
                 data={"name": "bad-type", "dataset_type": "wrong_type"},
                 files={"file": ("bad.csv", io.BytesIO(b"q,a\n1,2"), "text/csv")},
                 headers=_hdr(token))
        assert r.status_code == 422
        print("OK    invalid dataset_type enum rejected")

        # Delete + 404
        del_id = created.pop(0)
        _ok("delete dataset", _req("DELETE", f"/datasets/{del_id}", headers=_hdr(token)), 204)
        r = _req("GET", f"/datasets/{del_id}", headers=_hdr(token))
        assert r.status_code == 404
        print("OK    deleted dataset returns 404")

    finally:
        for ds_id in created:
            _del(token, ds_id)


# ═══════════════════════════════════════════════════════════════════════════════
# Download endpoint
# ═══════════════════════════════════════════════════════════════════════════════

def test_dataset_download() -> None:
    suffix = uuid.uuid4().hex[:8]
    token_a = _auth()

    # Register a second user for isolation test
    email_b = f"dl-b-{suffix}@x.com"
    resp_b = _req("POST", "/auth/register", json={"email": email_b, "password": "dlpass99"})
    token_b = resp_b.json()["access_token"] if resp_b.ok else ""

    csv_id = jsonl_id = None
    try:
        # CSV download
        csv_content = _csv(["question_id","question","true_answer"], ["q1","What is 1+1?","2"])
        csv_ds = _upload(token_a, name=f"dl-csv-{suffix}", dataset_type="open_with_true",
                         content=csv_content, filename="dl.csv", content_type="text/csv")
        csv_id = csv_ds["id"]

        r = _req("GET", f"/datasets/{csv_id}/download", headers=_hdr(token_a))
        _ok("CSV download 200", r, 200)
        assert "text/csv" in r.headers.get("content-type", ""), r.headers
        assert "attachment" in r.headers.get("content-disposition", ""), r.headers
        print("OK    CSV download returns text/csv with attachment disposition")

        # JSONL download (converted to CSV)
        records = [{"prompt": "Largest ocean?", "answer": "Pacific Ocean"},
                   {"prompt": "H2O?", "answer": "Water"}]
        jsonl_content = "\n".join(json.dumps(rec) for rec in records)
        jsonl_ds = _upload(token_a, name=f"dl-jsonl-{suffix}", dataset_type="open_with_true",
                           content=jsonl_content, filename="dl.jsonl", content_type="application/x-ndjson")
        jsonl_id = jsonl_ds["id"]
        _ok("map jsonl", _req("POST", f"/datasets/{jsonl_id}/map",
            json={"question": "prompt", "true_answer": "answer"}, headers=_hdr(token_a)), 200)

        r = _req("GET", f"/datasets/{jsonl_id}/download", headers=_hdr(token_a))
        _ok("JSONL download 200 as CSV", r, 200)
        assert "text/csv" in r.headers.get("content-type", ""), r.headers
        rows = list(csv.reader(io.StringIO(r.text)))
        assert len(rows) >= 2, f"converted CSV too short: {rows}"
        print("OK    JSONL download converted to CSV with at least one data row")

        # Cross-user isolation
        if token_b:
            r = _req("GET", f"/datasets/{csv_id}/download", headers=_hdr(token_b))
            assert r.status_code == 404
            print("OK    other user cannot download dataset -> 404")

        # Non-existent dataset
        r = _req("GET", "/datasets/99999999/download", headers=_hdr(token_a))
        assert r.status_code == 404
        print("OK    download of non-existent dataset -> 404")

    finally:
        _del(token_a, csv_id)
        _del(token_a, jsonl_id)
