"""
Pure unit tests — no API server or database required.

Covers:
  - Judge logic  (Equals, Contains, JSONEquals, LLMBool, LLMScore)
  - Pricing      (model-ID normalization, vendor shortcuts)
  - Judge setup  (thinking-param stripping, max_tokens enforcement)
  - ModelClient  (thinking -> extra_body routing, reasoning fallback)

Run with:
    pytest tests/test_unit.py
"""

from __future__ import annotations

import math
import sys
import types
from unittest.mock import MagicMock, patch

import pandas as pd


# ── module stubs ──────────────────────────────────────────────────────────────

def _stub(name: str, **attrs) -> types.ModuleType:
    mod = types.ModuleType(name)
    for k, v in attrs.items():
        setattr(mod, k, v)
    return mod


_fernet = _stub("cryptography.fernet", Fernet=object)
_crypto = _stub("cryptography"); _crypto.fernet = _fernet

for _n, _m in [
    ("anthropic",          _stub("anthropic", AuthenticationError=Exception, NotFoundError=Exception, Anthropic=object)),
    ("google",             _stub("google")),
    ("google.genai",       _stub("google.genai", Client=object)),
    ("cryptography",       _crypto),
    ("cryptography.fernet", _fernet),
    ("openai",             _stub("openai", OpenAI=object, APIError=Exception)),
]:
    sys.modules.setdefault(_n, _m)

if not hasattr(sys.modules.get("cryptography.fernet"), "Fernet"):
    sys.modules["cryptography.fernet"].Fernet = object

from core.judges import create_judge
from core.judges.contains import Contains
from core.judges.equals import Equals
from core.judges.json_equals import JSONEquals
from core.judges.llm_bool import PromptBasedBool
from core.judges.llm_score import PromptBasedScore
from core.model_client import LLMResponse, ModelClient
from core.pricing import calculate_cost
from db_models.experiment import JudgeType


# ═══════════════════════════════════════════════════════════════════════════════
# Judge logic
# ═══════════════════════════════════════════════════════════════════════════════

class _FakeModel:
    def __init__(self, outputs: list[str]) -> None:
        self._outputs = outputs
        self._calls = 0

    def generate(self, prompt: str) -> LLMResponse:
        out = self._outputs[min(self._calls, len(self._outputs) - 1)]
        self._calls += 1
        return LLMResponse(content=out, ttft_ms=1.0, e2e_ms=2.0)


def test_equals_judge():
    j = Equals()
    assert j.check_single_answer("  paris ", "PARIS") == 1
    assert j.check_single_answer("Paris", "Rome") == 0


def test_contains_judge():
    j = Contains()
    assert j.check_single_answer("The answer is: Pacific Ocean.", "pacific ocean") == 1
    assert j.check_single_answer("Atlantic", "Pacific") == 0


def test_json_equals_judge():
    j = JSONEquals()
    assert j.check_single_answer('{"b":2,"a":1}', '{"a":1,"b":2}') == 1
    assert j.check_single_answer('["A","B"]', '["B","A"]') == 0

    df = pd.DataFrame([
        {"model_answer": '{"x":1}', "true_answer": '{"x":1}'},
        {"model_answer": "not-json", "true_answer": '{"x":1}'},
    ])
    result = j.check_answers(df)
    assert result["is_correct"].tolist() == [1, 0]


def test_llm_bool_retries_ambiguous():
    j = PromptBasedBool(_FakeModel(["maybe", "correct"]), ["correct", "yes"], ["incorrect", "no"])
    assert j.check_single_answer(model_answer="x")["is_correct"] == 1


def test_llm_bool_returns_none_for_unknown():
    # _classify checks the first word first; neither "maybe" nor "dunno" matches any token
    j = PromptBasedBool(_FakeModel(["maybe", "dunno"]), ["correct"], ["incorrect"])
    assert j.check_single_answer(model_answer="x")["is_correct"] is None


def test_llm_score_retries_out_of_range():
    j = PromptBasedScore(_FakeModel(["11", "8.5"]), 0, 10)
    assert j.check_single_answer(model_answer="x")["score"] == 8.5


def test_llm_score_nan_for_invalid_output():
    j = PromptBasedScore(_FakeModel(["not numeric", "still bad"]), 0, 10)
    df = pd.DataFrame([{"question": "q", "model_answer": "a", "true_answer": "t"}])
    result = j.check_answers(df)
    assert math.isnan(float(result.loc[0, "score"]))


# ═══════════════════════════════════════════════════════════════════════════════
# Pricing — calculate_cost normalization
# ═══════════════════════════════════════════════════════════════════════════════

_PRICING = {
    "anthropic/claude-3-haiku":            {"input": 0.000001, "output": 0.000005},
    "anthropic/claude-haiku-4.5":          {"input": 0.000002, "output": 0.000006},
    "anthropic/claude-haiku-4-5-20251001": {"input": 0.000003, "output": 0.000007},
}


def _mock_pricing(data=None):
    return patch("core.pricing.get_all_openrouter_pricing", return_value=data or _PRICING)


def test_pricing_exact_match():
    with _mock_pricing():
        cost = calculate_cost("anthropic", "claude-3-haiku", prompt_tokens=1000, completion_tokens=500)
    assert cost == round(1000 * 0.000001 + 500 * 0.000005, 6)


def test_pricing_hyphen_normalized_to_dot():
    with _mock_pricing():
        cost = calculate_cost("anthropic", "claude-haiku-4-5", prompt_tokens=1000, completion_tokens=0)
    assert cost == round(1000 * 0.000002, 6)


def test_pricing_date_suffix_prefix_match():
    data = {k: v for k, v in _PRICING.items() if k != "anthropic/claude-haiku-4.5"}
    with _mock_pricing(data):
        cost = calculate_cost("anthropic", "claude-haiku-4-5", prompt_tokens=1000, completion_tokens=0)
    assert cost == round(1000 * 0.000003, 6)


def test_pricing_unknown_model_returns_zero():
    with _mock_pricing():
        assert calculate_cost("openai", "gpt-99-turbo", prompt_tokens=1000, completion_tokens=500) == 0.0


def test_pricing_local_and_ollama_skip_lookup():
    for vendor in ("local", "ollama"):
        with patch("core.pricing.get_all_openrouter_pricing") as fn:
            assert calculate_cost(vendor, "any-model", prompt_tokens=999, completion_tokens=999) == 0.0
            fn.assert_not_called()


def test_pricing_openrouter_vendor_direct():
    data = {"my-org/my-model": {"input": 0.00001, "output": 0.00002}}
    with _mock_pricing(data):
        cost = calculate_cost("openrouter", "my-org/my-model", prompt_tokens=500, completion_tokens=200)
    assert cost == round(500 * 0.00001 + 200 * 0.00002, 6)


# ═══════════════════════════════════════════════════════════════════════════════
# Judge setup — thinking-param stripping and max_tokens enforcement
# ═══════════════════════════════════════════════════════════════════════════════

def _fake_client(model_name: str, params: dict) -> ModelClient:
    c = ModelClient.__new__(ModelClient)
    c.model_name = model_name
    c.params = dict(params)
    return c


def _judge_model(model_name: str) -> MagicMock:
    jm = MagicMock()
    jm.model_name = model_name
    jm.correct_tokens = ["correct"]
    jm.incorrect_tokens = ["incorrect"]
    jm.score_min = 0
    jm.score_max = 10
    return jm


def test_judge_strips_thinking_params():
    for key in ("thinking", "thinking_config", "include_reasoning"):
        client = _fake_client("openai/gpt-4o", {key: True})
        with patch("core.judges.get_model_client", return_value=client):
            create_judge(JudgeType.LLM_BOOL, judge_model=_judge_model("openai/gpt-4o"))
        assert key not in client.params


def test_judge_claude_gets_thinking_disabled():
    for name in ("anthropic/claude-3-haiku", "anthropic/claude-haiku-4-5", "some/claude-custom"):
        client = _fake_client(name, {})
        with patch("core.judges.get_model_client", return_value=client):
            create_judge(JudgeType.LLM_BOOL, judge_model=_judge_model(name))
        assert client.params.get("thinking") == {"type": "disabled"}, name


def test_judge_non_claude_no_thinking_added():
    for name in ("openai/gpt-4o", "google/gemini-2.0-flash"):
        client = _fake_client(name, {})
        with patch("core.judges.get_model_client", return_value=client):
            create_judge(JudgeType.LLM_BOOL, judge_model=_judge_model(name))
        assert "thinking" not in client.params


def test_judge_vendor_client_no_thinking_injected():
    class FakeVendor:
        model_name = "anthropic/claude-3-haiku"
        params: dict = {}
    client = FakeVendor()
    with patch("core.judges.get_model_client", return_value=client):
        create_judge(JudgeType.LLM_BOOL, judge_model=_judge_model("anthropic/claude-3-haiku"))
    assert "thinking" not in client.params


def test_judge_low_max_tokens_bumped():
    for tok_key, val in [("max_tokens", 100), ("max_tokens", 0), ("max_completion_tokens", 50)]:
        client = _fake_client("openai/gpt-4o", {tok_key: val})
        with patch("core.judges.get_model_client", return_value=client):
            create_judge(JudgeType.LLM_BOOL, judge_model=_judge_model("openai/gpt-4o"))
        assert client.params[tok_key] == 512


def test_judge_adequate_max_tokens_unchanged():
    client = _fake_client("openai/gpt-4o", {"max_tokens": 2048})
    with patch("core.judges.get_model_client", return_value=client):
        create_judge(JudgeType.LLM_BOOL, judge_model=_judge_model("openai/gpt-4o"))
    assert client.params["max_tokens"] == 2048


# ═══════════════════════════════════════════════════════════════════════════════
# ModelClient — thinking -> extra_body and reasoning fallback
# ═══════════════════════════════════════════════════════════════════════════════

def _client_with_stream(params: dict, chunks: list):
    c = ModelClient.__new__(ModelClient)
    c.model_name = "test-model"
    c.params = dict(params)
    c.system_prompt = None
    captured: dict = {}

    def fake_create(**kw):
        captured.update(kw)
        return iter(chunks)

    c.client = MagicMock()
    c.client.chat.completions.create.side_effect = fake_create
    return c, captured


def _chunk(content=None, reasoning=None):
    delta = MagicMock()
    delta.content = content
    delta.reasoning = reasoning
    delta.model_extra = {"reasoning": reasoning} if reasoning else {}
    ch = MagicMock()
    ch.choices = [MagicMock(delta=delta)]
    ch.usage = None
    return ch


def test_thinking_true_maps_to_extra_body():
    c, captured = _client_with_stream({"thinking": True}, [])
    try: c.generate("hi")
    except Exception: pass
    assert captured.get("extra_body") == {"thinking": {"type": "enabled", "budget_tokens": 16000}}


def test_thinking_dict_forwarded_to_extra_body():
    custom = {"type": "enabled", "budget_tokens": 8000}
    c, captured = _client_with_stream({"thinking": custom}, [])
    try: c.generate("hi")
    except Exception: pass
    assert captured.get("extra_body") == {"thinking": custom}


def test_thinking_false_no_extra_body():
    c, captured = _client_with_stream({"thinking": False}, [])
    try: c.generate("hi")
    except Exception: pass
    assert captured.get("extra_body") is None


def test_reasoning_fallback_when_content_empty():
    c, _ = _client_with_stream({}, [_chunk(reasoning="step one "), _chunk(reasoning="step two")])
    assert c.generate("hi").content == "step one step two"


def test_content_takes_priority_over_reasoning():
    c, _ = _client_with_stream({}, [_chunk(content="answer", reasoning="internal")])
    assert c.generate("hi").content == "answer"


def test_both_empty_returns_empty_string():
    c, _ = _client_with_stream({}, [_chunk()])
    assert c.generate("hi").content == ""
