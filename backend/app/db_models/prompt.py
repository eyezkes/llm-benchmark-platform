from enum import Enum
from typing import List
from sqlalchemy import Column
from sqlalchemy.types import JSON
from sqlmodel import SQLModel, Field


class PromptType(str, Enum):
    MODEL = "model"
    JUDGE = "judge"


class Prompt(SQLModel, table=True):
    __table_args__ = {'extend_existing': True}
    id: int | None = Field(default=None, primary_key=True)
    name: str = Field(index=True)
    content: str
    prompt_type: PromptType = Field(index=True)
    # DatasetType value or None = compatible with any dataset type
    dataset_type: str | None = Field(default=None, index=True)
    is_builtin: bool = Field(default=False, index=True)
    # None for built-in prompts, set for user-created prompts
    user_id: int | None = Field(default=None, foreign_key="users.id", index=True)
    # Which evaluation method this prompt is designed for (JudgeType value or None = any)
    eval_type: str | None = Field(default=None, index=True)
    # Judge-specific fields (stored as plain strings to avoid PG enum issues)
    judge_mode: str | None = None  # "boolean" | "score"
    score_min: float | None = None
    score_max: float | None = None
    correct_tokens: List[str] | None = Field(default=None, sa_column=Column(JSON, nullable=True))
    incorrect_tokens: List[str] | None = Field(default=None, sa_column=Column(JSON, nullable=True))
