from datetime import datetime, timezone
from enum import Enum
from typing import Any, Dict, Optional
from sqlalchemy import Column
from sqlalchemy.types import JSON
from sqlmodel import SQLModel, Field


class DatasetType(str, Enum):
    MC_WITH_TRUE = "mc_with_true"
    OPEN_WITH_TRUE = "open_with_true"
    NO_TRUE_ANSWER = "no_true_answer"


class DatasetStatus(str, Enum):
    UPLOADED = "uploaded"
    READY = "ready"


class Dataset(SQLModel, table=True):
    __table_args__ = {'extend_existing': True}
    id: int | None = Field(default=None, primary_key=True)
    name: str = Field(index=True)
    dataset_type: DatasetType = Field(index=True)
    description: str | None = None
    file_path: str
    status: DatasetStatus = Field(default=DatasetStatus.UPLOADED, index=True)
    number_of_questions: int = 0
    column_mapping: Optional[Dict[str, Any]] = Field(
        default=None, sa_column=Column(JSON, nullable=True)
    )
    user_id: int = Field(foreign_key="users.id", index=True)
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
