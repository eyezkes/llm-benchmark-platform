from datetime import datetime
from sqlmodel import SQLModel


class UserCreate(SQLModel):
    email: str
    password: str


class UserRead(SQLModel):
    id: int
    email: str
    created_at: datetime


class ChangePassword(SQLModel):
    old_password: str
    new_password: str


class RefreshTokenRequest(SQLModel):
    refresh_token: str
