from __future__ import annotations
import logging
import pandas as pd

from core.judges.base import BaseJudge
from core.utils import validate_required_columns
from core.errors import EvaluationError

logger = logging.getLogger(__name__)


class Equals(BaseJudge):
    def check_single_answer(self, model_answer: str, true_answer: str) -> int:
        if true_answer is None:
            raise EvaluationError("true_answer cannot be None for Equals.")
        return 1 if str(model_answer).strip().upper() == str(true_answer).strip().upper() else 0

    def check_answers(self, df: pd.DataFrame) -> pd.DataFrame:
        validate_required_columns(df, ["model_answer", "true_answer"])
        df["is_correct"] = df.apply(
            lambda r: self.check_single_answer(r["model_answer"], r["true_answer"]), axis=1
        )
        return df
