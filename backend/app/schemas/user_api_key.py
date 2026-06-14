from datetime import datetime
from sqlmodel import SQLModel


class UserApiKeyCreate(SQLModel):
    vendor: str
    label: str
    api_key: str


class UserApiKeyRead(SQLModel):
    id: int
    vendor: str
    label: str
    masked: str
    created_at: datetime
