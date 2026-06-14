"""
Smoke-test script for models, judge models, datasets, and experiments.

Run with pytest from the project root:
    pytest tests/test_models_experiments.py

Or manually:
    python tests/test_models_experiments.py

Environment variables (loaded from tests/.env.test or os.environ):
    BASE_URL=http://localhost:8000
    TEST_EMAIL=test@example.com
    TEST_PASSWORD=testpass123

    OPENAI_API_KEY=...
    ANTHROPIC_API_KEY=...
    GOOGLE_API_KEY=...
    OPENROUTER_API_KEY=...
    OLLAMA_BASE_URL=http://localhost:11434/v1

Optional model overrides:
    OPENAI_MODEL=gpt-4.1
    ANTHROPIC_MODEL=claude-haiku-4-5
    GOOGLE_MODEL=gemini-2.5-flash
    OPENROUTER_MODELS=openai/gpt-4.1,google/gemini-2.5-flash,anthropic/claude-haiku-4-5
    OLLAMA_MODEL=llama3.2:1b
    CANDIDATE_MODEL_LIMIT=2
"""

from __future__ import annotations

import io
import csv
import json
import os
import sys
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import requests


def load_env_file() -> None:
    env_path = Path(__file__).resolve().parent / ".env.test"
    if not env_path.exists():
        return
    for raw_line in env_path.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        key = key.strip()
        value = value.strip().strip('"').strip("'")
        if key and key not in os.environ:
            os.environ[key] = value


load_env_file()

BASE_URL = os.getenv("BASE_URL", "http://localhost:8000").rstrip("/")
EMAIL = os.getenv("TEST_EMAIL", "test@example.com")
PASSWORD = os.getenv("TEST_PASSWORD", "testpass123")
RUN_EXPERIMENTS = os.getenv("RUN_EXPERIMENTS", "1") == "1"
POLL_TIMEOUT_SECONDS = int(os.getenv("POLL_TIMEOUT_SECONDS", "300"))
CANDIDATE_MODEL_LIMIT = int(os.getenv("CANDIDATE_MODEL_LIMIT", "2"))


@dataclass(frozen=True)
class VendorSpec:
    label: str
    name: str
    provider: str
    model_name: str
    api_key: str | None = None
    base_url: str | None = None
    params: dict[str, Any] | None = None


session = requests.Session()


def section(title: str) -> None:
    print(f"\n{'=' * 72}\n{title}\n{'=' * 72}")


def auth_headers(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


def request_json(method: str, path: str, *, label: str, **kwargs: Any) -> Any:
    try:
        response = session.request(method, f"{BASE_URL}{path}", timeout=60, **kwargs)
    except requests.RequestException as exc:
        raise RuntimeError(f"{label}: connection error during {method} {path}: {exc}") from exc
    if not response.ok:
        print(f"FAIL  {label} [{response.status_code}]")
        print(response.text)
        return None
    if response.status_code == 204 or not response.content:
        print(f"OK    {label}")
        return {}
    print(f"OK    {label}")
    return response.json()


def require_json(method: str, path: str, *, label: str, **kwargs: Any) -> Any:
    data = request_json(method, path, label=label, **kwargs)
    if data is None:
        raise RuntimeError(f"Request failed: {label}")
    return data


def login_or_register() -> tuple[str, str | None]:
    section("Auth")
    payload = {"email": EMAIL, "password": PASSWORD}
    try:
        response = session.post(f"{BASE_URL}/auth/register", json=payload, timeout=30)
    except requests.RequestException as exc:
        raise RuntimeError(f"register user: connection error during POST /auth/register: {exc}") from exc
    if response.status_code == 400 and "already registered" in response.text.lower():
        try:
            response = session.post(f"{BASE_URL}/auth/login", json=payload, timeout=30)
        except requests.RequestException as exc:
            raise RuntimeError(f"login existing user: connection error during POST /auth/login: {exc}") from exc
        label = "login existing user"
    else:
        label = "register user"
    if not response.ok:
        raise RuntimeError(f"{label} failed [{response.status_code}]: {response.text}")
    data = response.json()
    print(f"OK    {label}")

    refresh_token = data.get("refresh_token")
    if refresh_token:
        refreshed = request_json(
            "POST",
            "/auth/refresh",
            label="refresh access token",
            json={"refresh_token": refresh_token},
        )
        if refreshed and refreshed.get("access_token"):
            return refreshed["access_token"], refresh_token
    return data["access_token"], refresh_token


def vendor_specs() -> list[VendorSpec]:
    specs: list[VendorSpec] = []

    if os.getenv("OPENAI_API_KEY"):
        specs.append(VendorSpec(label="openai", name="OpenAI candidate", provider="openai", model_name=os.getenv("OPENAI_MODEL", "gpt-4.1"), api_key=os.getenv("OPENAI_API_KEY"), params={"temperature": 0, "max_completion_tokens": 128}))
    else:
        print("SKIP  OpenAI: OPENAI_API_KEY is not set")

    if os.getenv("ANTHROPIC_API_KEY"):
        specs.append(VendorSpec(label="anthropic", name="Anthropic candidate", provider="anthropic", model_name=os.getenv("ANTHROPIC_MODEL", "claude-haiku-4-5"), api_key=os.getenv("ANTHROPIC_API_KEY"), params={"temperature": 0, "max_tokens": 128}))
    else:
        print("SKIP  Anthropic: ANTHROPIC_API_KEY is not set")

    if os.getenv("GOOGLE_API_KEY"):
        specs.append(VendorSpec(label="google", name="Google Gemini candidate", provider="google", model_name=os.getenv("GOOGLE_MODEL", "gemini-2.5-flash"), api_key=os.getenv("GOOGLE_API_KEY"), params={"temperature": 0, "max_output_tokens": 128}))
    else:
        print("SKIP  Google: GOOGLE_API_KEY is not set")

    openrouter_api_key = os.getenv("OPENROUTER_API_KEY")
    if openrouter_api_key:
        openrouter_models = [m.strip() for m in os.getenv("OPENROUTER_MODELS", "openai/gpt-4.1,google/gemini-2.5-flash,anthropic/claude-haiku-4-5").split(",") if m.strip()]
        for index, model_name in enumerate(openrouter_models, start=1):
            specs.append(VendorSpec(label=f"openrouter-{index}", name=f"OpenRouter candidate {index}", provider="openrouter", model_name=model_name, api_key=openrouter_api_key, params={"temperature": 0}))
    else:
        print("SKIP  OpenRouter: OPENROUTER_API_KEY is not set")

    ollama_base_url = os.getenv("OLLAMA_BASE_URL")
    if ollama_base_url:
        specs.append(VendorSpec(label="ollama", name="Ollama candidate", provider="ollama", model_name=os.getenv("OLLAMA_MODEL", "llama3.2:1b"), base_url=ollama_base_url, params={"temperature": 0, "max_tokens": 128}))
    else:
        print("SKIP  Ollama: OLLAMA_BASE_URL is not set")

    return specs


def model_payload(spec: VendorSpec, *, as_judge: bool = False, mode: str | None = None) -> dict[str, Any]:
    payload: dict[str, Any] = {"name": f"{spec.name} judge" if as_judge else spec.name, "provider": spec.provider, "model_name": spec.model_name, "api_key": spec.api_key, "base_url": spec.base_url, "params": spec.params or {}}
    if as_judge:
        payload["mode"] = mode
        if mode == "score":
            payload["score_min"] = 0
            payload["score_max"] = 10
            payload["system_prompt"] = "Grade the answer from 0 to 10. Return only a number."
        elif mode == "boolean":
            payload["correct_tokens"] = ["correct", "yes"]
            payload["incorrect_tokens"] = ["incorrect", "no"]
            payload["system_prompt"] = "Decide whether the answer is correct. Return only 'correct' or 'incorrect'."
    return payload


def create_models(token: str) -> dict[str, int]:
    section("Candidate Models")
    ids: dict[str, int] = {}
    for spec in vendor_specs():
        data = request_json("POST", "/models/", label=f"create candidate model: {spec.label}", json=model_payload(spec), headers=auth_headers(token))
        if data and data.get("id"):
            ids[spec.label] = data["id"]
            print(f"      id={data['id']} provider={data['provider']} model={data['model_name']}")
    require_json("GET", "/models/", label="list candidate models", headers=auth_headers(token))
    return ids


def create_judge_models(token: str) -> tuple[int | None, int | None]:
    section("Judge Models")
    specs = vendor_specs()
    if not specs:
        print("SKIP  Judge models: no vendor API key or local base URL configured")
        return None, None
    judge_spec = specs[0]
    bool_data = request_json("POST", "/judge-models/", label=f"create boolean judge model: {judge_spec.label}", json=model_payload(judge_spec, as_judge=True, mode="boolean"), headers=auth_headers(token))
    score_data = request_json("POST", "/judge-models/", label=f"create score judge model: {judge_spec.label}", json=model_payload(judge_spec, as_judge=True, mode="score"), headers=auth_headers(token))
    require_json("GET", "/judge-models/", label="list judge models", headers=auth_headers(token))
    return (bool_data.get("id") if bool_data else None, score_data.get("id") if score_data else None)


def upload_dataset(token: str, *, label: str, dataset_type: str, content: str, filename: str, content_type: str, mapping: dict[str, Any]) -> int | None:
    data = request_json("POST", "/datasets/upload", label=f"upload dataset: {label}", data={"name": label, "dataset_type": dataset_type, "description": f"{label} smoke test"}, files={"file": (filename, io.BytesIO(content.encode("utf-8")), content_type)}, headers=auth_headers(token))
    if not data:
        return None
    dataset_id = data["id"]
    request_json("GET", f"/datasets/{dataset_id}/columns", label=f"columns: {label}", headers=auth_headers(token))
    mapped = request_json("POST", f"/datasets/{dataset_id}/map", label=f"map dataset: {label}", json=mapping, headers=auth_headers(token))
    if mapped:
        print(f"      id={dataset_id} type={mapped['dataset_type']} questions={mapped['number_of_questions']} status={mapped['status']}")
    return dataset_id


def create_datasets(token: str) -> dict[str, int]:
    section("Datasets")
    dataset_ids: dict[str, int] = {}

    def make_csv(headers: list[str], rows: list[list[Any]]) -> str:
        buffer = io.StringIO()
        writer = csv.writer(buffer, lineterminator="\n")
        writer.writerow(headers)
        writer.writerows(rows)
        return buffer.getvalue()

    mc_rows = [
        ["q1", "What is the capital of France?", json.dumps(["A) Berlin", "B) Paris", "C) Rome"]), "B", "geography"],
        ["q2", "Which planet is closest to the Sun?", json.dumps(["A) Venus", "B) Mercury", "C) Earth"]), "B", "science"],
        ["q3", "What is 7 * 8?", json.dumps(["A) 54", "B) 56", "C) 64"]), "B", "math"],
    ]
    mc_id = upload_dataset(token, label="smoke-mc-csv", dataset_type="mc_with_true", content=make_csv(["question_id", "question", "options", "true_answer", "category"], mc_rows), filename="smoke-mc.csv", content_type="text/csv", mapping={"question_id": "question_id", "question": "question", "options": "options", "true_answer": "true_answer", "category": "category"})
    if mc_id:
        dataset_ids["mc"] = mc_id

    open_id = upload_dataset(token, label="smoke-open-csv", dataset_type="open_with_true", content=make_csv(["question_id", "question", "true_answer", "category"], [["q1", "What year did World War II end?", "1945", "history"], ["q2", "What is the SI unit of electrical resistance?", "Ohm", "physics"], ["q3", "Who developed general relativity?", "Albert Einstein", "science"]]), filename="smoke-open.csv", content_type="text/csv", mapping={"question_id": "question_id", "question": "question", "true_answer": "true_answer", "category": "category"})
    if open_id:
        dataset_ids["open"] = open_id

    gen_records = [{"question_id": "q1", "prompt": "Explain recursion in one short paragraph.", "category": "explanation"}, {"question_id": "q2", "prompt": "Write a haiku about benchmarks.", "category": "creative"}, {"question_id": "q3", "prompt": "List two REST API design practices.", "category": "design"}]
    gen_id = upload_dataset(token, label="smoke-generative-jsonl", dataset_type="no_true_answer", content="\n".join(json.dumps(r) for r in gen_records), filename="smoke-generative.jsonl", content_type="application/x-ndjson", mapping={"question_id": "question_id", "question": "prompt", "category": "category"})
    if gen_id:
        dataset_ids["gen"] = gen_id

    require_json("GET", "/datasets/", label="list datasets", headers=auth_headers(token))
    return dataset_ids


def selected_candidates(model_ids: dict[str, int], offset: int = 0) -> list[int]:
    ids = list(model_ids.values())
    if not ids:
        return []
    limit = max(1, min(CANDIDATE_MODEL_LIMIT, len(ids)))
    rotated = ids[offset:] + ids[:offset]
    return rotated[:limit]


def create_experiments(token: str, model_ids: dict[str, int], dataset_ids: dict[str, int], bool_judge_id: int | None, score_judge_id: int | None) -> dict[str, int]:
    section("Experiments")
    if not model_ids:
        print("SKIP  Experiments: no candidate models were created")
        return {}

    experiment_ids: dict[str, int] = {}

    def create_experiment(label: str, payload: dict[str, Any]) -> int | None:
        data = request_json("POST", "/experiments", label=f"create experiment: {label}", json=payload, headers=auth_headers(token))
        if data and data.get("id"):
            print(f"      id={data['id']} status={data['status']}")
            return data["id"]
        return None

    if dataset_ids.get("mc"):
        exp_id = create_experiment("mc-equals", {"name": "Smoke MC equals", "dataset_id": dataset_ids["mc"], "candidate_model_ids": selected_candidates(model_ids, 0), "judge_configs": [{"judge_type": "equals"}], "sample_size": 3, "seed": 42, "measure_k": 2})
        if exp_id:
            experiment_ids["mc-equals"] = exp_id

    if dataset_ids.get("mc") and bool_judge_id:
        exp_id = create_experiment("mc-llm-bool", {"name": "Smoke MC LLM bool", "dataset_id": dataset_ids["mc"], "candidate_model_ids": selected_candidates(model_ids, 0), "judge_configs": [{"judge_type": "llm_bool", "judge_model_id": bool_judge_id}], "sample_size": 3, "seed": 43, "measure_k": 2})
        if exp_id:
            experiment_ids["mc-llm-bool"] = exp_id

    if dataset_ids.get("open"):
        exp_id = create_experiment("open-contains", {"name": "Smoke open contains", "dataset_id": dataset_ids["open"], "candidate_model_ids": selected_candidates(model_ids, 1), "judge_configs": [{"judge_type": "contains"}], "sample_size": 3, "seed": 44, "measure_k": 2})
        if exp_id:
            experiment_ids["open-contains"] = exp_id

    if dataset_ids.get("open") and bool_judge_id and score_judge_id:
        exp_id = create_experiment("open-llm-bool-score", {"name": "Smoke open LLM bool and score", "dataset_id": dataset_ids["open"], "candidate_model_ids": selected_candidates(model_ids, 1), "judge_configs": [{"judge_type": "llm_bool", "judge_model_id": bool_judge_id}, {"judge_type": "llm_score", "judge_model_id": score_judge_id}], "sample_size": 3, "seed": 45, "measure_k": 2})
        if exp_id:
            experiment_ids["open-llm-bool-score"] = exp_id

    if dataset_ids.get("gen") and score_judge_id:
        exp_id = create_experiment("gen-llm-score", {"name": "Smoke generative LLM score", "dataset_id": dataset_ids["gen"], "candidate_model_ids": selected_candidates(model_ids, 2), "judge_configs": [{"judge_type": "llm_score", "judge_model_id": score_judge_id}], "sample_size": 3, "seed": 46, "measure_k": 2})
        if exp_id:
            experiment_ids["gen-llm-score"] = exp_id

    require_json("GET", "/experiments", label="list experiments", headers=auth_headers(token))
    return experiment_ids


def run_and_poll(token: str, experiment_ids: dict[str, int]) -> None:
    section("Run Experiments")
    if not RUN_EXPERIMENTS:
        print("SKIP  RUN_EXPERIMENTS is 0")
        return

    for label, exp_id in experiment_ids.items():
        request_json("POST", f"/experiments/{exp_id}/run", label=f"queue experiment: {label}", headers=auth_headers(token))

    deadline = time.time() + POLL_TIMEOUT_SECONDS
    pending = set(experiment_ids.values())
    while pending and time.time() < deadline:
        time.sleep(5)
        for exp_id in list(pending):
            exp = request_json("GET", f"/experiments/{exp_id}", label=f"poll experiment {exp_id}", headers=auth_headers(token))
            if exp and exp.get("status") in {"completed", "failed"}:
                pending.remove(exp_id)
                print(f"      experiment={exp_id} status={exp['status']} runs={[r['status'] for r in exp.get('runs', [])]}")

    if pending:
        print(f"WARN  Timed out waiting for experiments: {sorted(pending)}")


def main() -> int:
    try:
        token, _ = login_or_register()
        model_ids = create_models(token)
        bool_judge_id, score_judge_id = create_judge_models(token)
        dataset_ids = create_datasets(token)
        experiment_ids = create_experiments(token, model_ids, dataset_ids, bool_judge_id, score_judge_id)
        run_and_poll(token, experiment_ids)

        section("Summary")
        print(f"Candidate models: {model_ids}")
        print(f"Judge models: bool={bool_judge_id}, score={score_judge_id}")
        print(f"Datasets: {dataset_ids}")
        print(f"Experiments: {experiment_ids}")
        return 0
    except Exception as exc:
        print(f"\nERROR {exc}", file=sys.stderr)
        return 1


def test_models_experiments() -> None:
    assert main() == 0


if __name__ == "__main__":
    raise SystemExit(main())
