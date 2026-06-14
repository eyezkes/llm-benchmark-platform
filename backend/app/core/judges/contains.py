from __future__ import annotations
import logging
import re
import unicodedata
import pandas as pd

from core.judges.base import BaseJudge
from core.utils import validate_required_columns
from core.errors import EvaluationError

logger = logging.getLogger(__name__)


def _normalize(s: str) -> str:
    if s is None:
        return ""
    s = unicodedata.normalize("NFKC", str(s)).casefold()
    # Remove thousands-separator commas: 1,500 → 1500, 1,000,000 → 1000000
    s = re.sub(r",(?=\d)", "", s)
    # Strip punctuation but keep decimal points (handled below)
    s = re.sub(r"[^\w\s''.]", " ", s)
    # Normalize trailing decimal zeros: 1.50 → 1.5, 2.00 → 2
    s = re.sub(r"\b(\d+\.\d*[1-9])0+\b", r"\1", s)
    s = re.sub(r"\b(\d+)\.0+\b", r"\1", s)
    # Remove dots that are not between two digits (sentence-ending dots etc.)
    s = re.sub(r"(?<!\d)\.(?!\d)", " ", s)
    return re.sub(r"\s+", " ", s).strip()


class Contains(BaseJudge):
    def check_single_answer(self, model_answer: str, true_answer: str) -> int:
        if not true_answer:
            raise EvaluationError("true_answer cannot be empty for Contains.")
        nt = _normalize(true_answer)
        nm = _normalize(model_answer)
        # Word-boundary match so "yes" doesn't hit "yesterday", "1577" doesn't hit "11577"
        return 1 if re.search(r"\b" + re.escape(nt) + r"\b", nm) else 0

    def check_answers(self, df: pd.DataFrame) -> pd.DataFrame:
        validate_required_columns(df, ["model_answer", "true_answer"])
        df["is_correct"] = df.apply(
            lambda r: self.check_single_answer(r["model_answer"], r["true_answer"]), axis=1
        )
        return df
