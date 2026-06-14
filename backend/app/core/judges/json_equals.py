from __future__ import annotations
from typing import Any
import json
import logging
import pandas as pd

from core.judges.base import BaseJudge
from core.utils import validate_required_columns
from core.errors import EvaluationError

logger = logging.getLogger(__name__)


class JSONEquals(BaseJudge):
    def _parse(self, text: str) -> Any:
        if text is None:
            raise EvaluationError("Cannot compare None as JSON.")
        try:
            return json.loads(text)
        except json.JSONDecodeError as e:
            raise EvaluationError(f"Invalid JSON: {text[:100]}... ({e})")

    def _deep_eq(self, a: Any, b: Any) -> bool:
        if type(a) != type(b):
            return False
        if isinstance(a, dict):
            return set(a.keys()) == set(b.keys()) and all(self._deep_eq(a[k], b[k]) for k in a)
        if isinstance(a, list):
            return len(a) == len(b) and all(self._deep_eq(x, y) for x, y in zip(a, b))
        return a == b

    def check_single_answer(self, model_answer: str, true_answer: str) -> int:
        return 1 if self._deep_eq(self._parse(model_answer), self._parse(true_answer)) else 0

    def check_answers(self, df: pd.DataFrame) -> pd.DataFrame:
        validate_required_columns(df, ["model_answer", "true_answer"])

        def safe(row):
            try:
                return self.check_single_answer(row["model_answer"], row["true_answer"])
            except EvaluationError as e:
                logger.warning("JSON equality failed: %s", e)
                return 0

        df["is_correct"] = df.apply(safe, axis=1)
        return df
