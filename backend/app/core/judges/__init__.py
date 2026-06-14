from __future__ import annotations
from typing import Optional

from core.model_adapter import get_model_client
from db_models.experiment import JudgeType
from db_models.model import JudgeModel

from core.judges.base import BaseJudge
from core.judges.equals import Equals
from core.judges.contains import Contains
from core.judges.json_equals import JSONEquals
from core.judges.llm_bool import PromptBasedBool
from core.judges.llm_score import PromptBasedScore
from core.judges.similarity import SimilarityJudge
from core.model_client import ModelClient


def create_judge(
    judge_type: JudgeType,
    judge_model: Optional[JudgeModel] = None,
) -> BaseJudge:
    if judge_type == JudgeType.EQUALS:
        return Equals()
    if judge_type == JudgeType.CONTAINS:
        return Contains()
    if judge_type == JudgeType.JSON_EQUALITY:
        return JSONEquals()
    if judge_type == JudgeType.SIMILARITY:
        return SimilarityJudge()

    if judge_model is None:
        raise ValueError(f"judge_model required for {judge_type}")

    client = get_model_client(judge_model)
    # Judges must return plain text. Strip any thinking/reasoning params so the
    # model doesn't consume its entire token budget on internal reasoning and
    # return empty content.
    for key in ("thinking", "thinking_config", "include_reasoning"):
        client.params.pop(key, None)
    # For OpenRouter Anthropic/Claude models, thinking is enabled by default even
    # when the key is absent. Explicitly disable it so the judge returns plain text.
    if isinstance(client, ModelClient):
        name_lower = client.model_name.lower()
        if name_lower.startswith("anthropic/") or "claude" in name_lower:
            client.params["thinking"] = {"type": "disabled"}
    # Ensure enough tokens for a structured text response (scores, yes/no).
    # Judge model configs sometimes store a small max_tokens that, combined with
    # any residual thinking behavior, leaves no room for actual text output.
    for tok_key in ("max_tokens", "max_completion_tokens", "max_output_tokens"):
        if tok_key in client.params and (client.params[tok_key] or 0) < 512:
            client.params[tok_key] = 512

    if judge_type == JudgeType.LLM_BOOL:
        return PromptBasedBool(
            model=client,
            correct_tokens=judge_model.correct_tokens or [],
            incorrect_tokens=judge_model.incorrect_tokens or [],
        )
    if judge_type == JudgeType.LLM_SCORE:
        return PromptBasedScore(
            model=client,
            score_min=judge_model.score_min or 0,
            score_max=judge_model.score_max or 10,
        )
    raise ValueError(f"Unknown judge type: {judge_type}")
