from datetime import datetime
from typing import Any, Dict, Optional
from sqlmodel import SQLModel
from db_models.dataset import DatasetType, DatasetStatus


class DatasetRead(SQLModel):
    id: int
    name: str
    dataset_type: DatasetType
    description: str | None = None
    file_path: str
    status: DatasetStatus
    number_of_questions: int
    column_mapping: Optional[Dict[str, Any]] = None
    created_at: datetime | None = None


class DatasetUpdate(SQLModel):
    name: str | None = None
    description: str | None = None


class DatasetMapRequest(SQLModel):
    """User maps their CSV column names to our standard roles."""
    question_id: str | None = None
    question: str
    options: str | None = None         # required for MC
    true_answer: str | None = None     # required for MC and open_with_true
    category: str | None = None        # optional, for per-category breakdowns
