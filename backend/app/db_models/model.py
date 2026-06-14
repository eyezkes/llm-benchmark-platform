from enum import Enum
from typing import List
from sqlalchemy import Column
from sqlalchemy.types import JSON
from sqlmodel import Field, SQLModel


class JudgeMode(str, Enum):
    SCORE = "score"
    BOOLEAN = "boolean"


class ModelBase(SQLModel):
    
    name: str
    provider: str                          # e.g. "openai", "anthropic", "local"
    model_name: str                        # e.g. "gpt-4o", "claude-sonnet-4-20250514"
    base_url: str | None = None            # for custom/self-hosted models
    api_key_encrypted: str | None = None   # Fernet-encrypted; never returned in API
    system_prompt: str | None = None
    params: dict | None = None


class Model(ModelBase, table=True):
    __table_args__ = {'extend_existing': True}
    id: int | None = Field(default=None, primary_key=True)
    params: dict = Field(default_factory=dict, sa_column=Column(JSON, nullable=True))
    user_id: int = Field(foreign_key="users.id", index=True)


class JudgeModel(ModelBase, table=True):
    __table_args__ = {'extend_existing': True}
    id: int | None = Field(default=None, primary_key=True)
    params: dict = Field(default_factory=dict, sa_column=Column(JSON, nullable=True))
    mode: JudgeMode = Field(index=True)
    score_min: float | None = None
    score_max: float | None = None
    correct_tokens: List[str] | None = Field(
        default=None, sa_column=Column(JSON, nullable=True)
    )
    incorrect_tokens: List[str] | None = Field(
        default=None, sa_column=Column(JSON, nullable=True)
    )
    user_id: int = Field(foreign_key="users.id", index=True)
