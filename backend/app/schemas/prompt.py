from typing import List
from sqlmodel import SQLModel
from db_models.prompt import PromptType
from db_models.dataset import DatasetType
from db_models.model import JudgeMode
from db_models.experiment import JudgeType


class PromptCreate(SQLModel):
    name: str
    content: str
    prompt_type: PromptType
    dataset_type: DatasetType | None = None
    eval_type: JudgeType | None = None
    judge_mode: JudgeMode | None = None
    score_min: float | None = None
    score_max: float | None = None
    correct_tokens: List[str] | None = None
    incorrect_tokens: List[str] | None = None


class PromptRead(SQLModel):
    id: int
    name: str
    content: str
    prompt_type: PromptType
    dataset_type: DatasetType | None = None
    eval_type: JudgeType | None = None
    is_builtin: bool
    user_id: int | None = None
    judge_mode: JudgeMode | None = None
    score_min: float | None = None
    score_max: float | None = None
    correct_tokens: List[str] | None = None
    incorrect_tokens: List[str] | None = None


class PromptUpdate(SQLModel):
    name: str | None = None
    content: str | None = None
    dataset_type: DatasetType | None = None
    eval_type: JudgeType | None = None
    judge_mode: JudgeMode | None = None
    score_min: float | None = None
    score_max: float | None = None
    correct_tokens: List[str] | None = None
    incorrect_tokens: List[str] | None = None
