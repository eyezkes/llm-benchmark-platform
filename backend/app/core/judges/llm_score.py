from __future__ import annotations
from concurrent.futures import ThreadPoolExecutor
from typing import Any
import logging
import time
import pandas as pd

from core.model_client import ModelClient
from core.errors import EvaluationError, ModelError
from core.judges.base import BaseJudge

logger = logging.getLogger(__name__)
CONCURRENT_REQUESTS = 3

MAX_RETRIES = 3


class PromptBasedScore(BaseJudge):
    def __init__(self, model: ModelClient, score_min: float, score_max: float) -> None:
        super().__init__(model=model)
        if score_min >= score_max:
            raise ValueError("score_min must be < score_max")
        self.score_min = float(score_min)
        self.score_max = float(score_max)

    def _build_msg(self, question: str | None, model_answer: str, true_answer: str | None) -> str:
        parts = []
        if question:
            parts.append(f"Question:\n{question}")
        if true_answer is not None:
            parts.append(f"Reference (ground truth):\n{true_answer}")
        parts.append(f"Model Answer:\n{model_answer}")
        return "\n\n".join(parts)

    def _parse_score(self, text: str) -> float:
        import re
        text = (text or "").strip()
        if not text:
            raise EvaluationError("Empty score from LLM.")
        try:
            return float(text)
        except ValueError:
            pass
        # Handle "7.5/10", "Score: 7.5", "7,5" etc.
        match = re.search(r"[-+]?\d+(?:[.,]\d+)?", text)
        if match:
            return float(match.group().replace(",", "."))
        raise EvaluationError(f"LLM output is not numeric: {text!r}")

    def check_single_answer(
        self,
        question: str | None = None,
        model_answer: str = "",
        true_answer: str | None = None,
    ) -> dict[str, Any]:
        if self.model is None:
            raise EvaluationError("Model required for PromptBasedScore.")

        msg = self._build_msg(question, model_answer, true_answer)

        for attempt in range(1 + MAX_RETRIES):
            try:
                resp = self.model.generate(msg)
                score = self._parse_score(resp.content)
                if self.score_min <= score <= self.score_max:
                    return {"score": score}
                if attempt == MAX_RETRIES:
                    raise EvaluationError(
                        f"Score {score} out of [{self.score_min}, {self.score_max}]"
                    )
                logger.info("LLM score: out of range, retrying (%d/%d)", attempt + 1, MAX_RETRIES)
            except (EvaluationError, ModelError) as e:
                if attempt == MAX_RETRIES:
                    raise
                wait = 2 ** attempt
                logger.warning("LLM score: failed, retrying in %ds — %s", wait, e)
                time.sleep(wait)

        return {"score": float("nan")}

    def check_answers(self, df: pd.DataFrame) -> pd.DataFrame:
        def _check_single(r):
            try:
                res = self.check_single_answer(
                    question=r.get("question"),
                    model_answer=r.get("model_answer", ""),
                    true_answer=r.get("true_answer"),
                )
                return res["score"]
            except (EvaluationError, ModelError) as e:
                logger.warning("PromptBasedScore row failed: %s", e)
                return float("nan")

        rows = [row for _, row in df.iterrows()]
        with ThreadPoolExecutor(max_workers=CONCURRENT_REQUESTS) as executor:
            scores = list(executor.map(_check_single, rows))
        df["score"] = scores
        return df
