from datetime import datetime, timezone
from sqlmodel import SQLModel, Field


class UserApiKey(SQLModel, table=True):
    __tablename__ = "user_api_key"
    __table_args__ = {"extend_existing": True}

    id: int | None = Field(default=None, primary_key=True)
    user_id: int = Field(foreign_key="users.id", index=True)
    vendor: str
    label: str
    api_key_encrypted: str
    masked: str  # stored at save time, e.g. "...r5kQ"
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
