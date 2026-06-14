from __future__ import annotations
from concurrent.futures import ThreadPoolExecutor
from typing import Any, Iterable, Optional
import logging
import re
import time
import pandas as pd

from core.model_client import ModelClient
from core.errors import EvaluationError, ModelError
from core.judges.base import BaseJudge

logger = logging.getLogger(__name__)

MAX_RETRIES = 3
CONCURRENT_REQUESTS = 3


class PromptBasedBool(BaseJudge):
    def __init__(
        self,
        model: ModelClient,
        correct_tokens: Iterable[str],
        incorrect_tokens: Iterable[str],
    ) -> None:
        super().__init__(model=model)
        self.correct_tokens = [str(t).strip().lower() for t in correct_tokens if str(t).strip()]
        if not self.correct_tokens:
            raise ValueError("At least one non-empty correct token is required.")
        self.incorrect_tokens = [str(t).strip().lower() for t in (incorrect_tokens or []) if str(t).strip()]

    def _build_msg(self, question: str | None, model_answer: str, true_answer: str | None) -> str:
        parts = []
        if question:
            parts.append(f"Question:\n{question}")
        if true_answer is not None:
            parts.append(f"Reference (ground truth):\n{true_answer}")
        parts.append(f"Model Answer:\n{model_answer}")
        return "\n\n".join(parts)

    def _classify(self, text: str) -> bool | None:
        t = (text or "").strip().lower()
        if not t:
            return None

        # First word is most reliable — avoids verbose-response ambiguity
        first_word = re.split(r"\W+", t)[0]
        for tok in self.correct_tokens:
            if first_word == tok:
                return True
        for tok in self.incorrect_tokens:
            if first_word == tok:
                return False

        # Fall back to whole-word scan to avoid "correct" matching inside "incorrect"
        has_pos = any(re.search(r"\b" + re.escape(tok) + r"\b", t) for tok in self.correct_tokens)
        has_neg = any(re.search(r"\b" + re.escape(tok) + r"\b", t) for tok in self.incorrect_tokens)
        if has_pos and not has_neg:
            return True
        if has_neg and not has_pos:
            return False
        return None

    def check_single_answer(
        self,
        question: str | None = None,
        model_answer: str = "",
        true_answer: str | None = None,
    ) -> dict[str, Any]:
        if self.model is None:
            raise EvaluationError("Model required for PromptBasedBool.")

        msg = self._build_msg(question, model_answer, true_answer)

        for attempt in range(1 + MAX_RETRIES):
            try:
                resp = self.model.generate(msg)
                label = self._classify(resp.content)
                if label is not None or attempt == MAX_RETRIES:
                    is_correct = 1 if label is True else (0 if label is False else None)
                    return {"is_correct": is_correct, "raw_output": resp.content}
                wait = 2 ** attempt
                logger.info("LLM bool: ambiguous output, retrying in %ds (%d/%d)", wait, attempt + 1, MAX_RETRIES)
                time.sleep(wait)
            except Exception as e:
                if attempt == MAX_RETRIES:
                    raise ModelError(f"LLM call failed after retries: {e}") from e
                wait = 2 ** attempt
                logger.warning("LLM bool: call failed, retrying in %ds: %s", wait, e)
                time.sleep(wait)

        return {"is_correct": None, "raw_output": ""}  # unreachable

    def check_answers(self, df: pd.DataFrame) -> pd.DataFrame:
        def _check_single(r):
            try:
                res = self.check_single_answer(
                    question=r.get("question"),
                    model_answer=r.get("model_answer", ""),
                    true_answer=r.get("true_answer"),
                )
                return res["is_correct"]
            except (EvaluationError, ModelError) as e:
                logger.warning("PromptBasedBool row failed: %s", e)
                return None

        rows = [row for _, row in df.iterrows()]
        with ThreadPoolExecutor(max_workers=CONCURRENT_REQUESTS) as executor:
            results = list(executor.map(_check_single, rows))
        df["is_correct"] = results
        return df
