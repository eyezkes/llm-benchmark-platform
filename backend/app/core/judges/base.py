from __future__ import annotations
from abc import ABC, abstractmethod
from typing import Optional

import pandas as pd

from core.model_client import ModelClient


class BaseJudge(ABC):
    def __init__(self, model: Optional[ModelClient] = None) -> None:
        self.model = model

    @abstractmethod
    def check_single_answer(self, **kwargs):
        pass

    @abstractmethod
    def check_answers(self, df: pd.DataFrame) -> pd.DataFrame:
        pass
