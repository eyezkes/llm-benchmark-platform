from sqlmodel import SQLModel


class ModelCreate(SQLModel):
    name: str
    provider: str
    model_name: str
    base_url: str | None = None
    api_key: str | None = None
    user_api_key_id: int | None = None  # alternative to api_key: reference to saved key
    system_prompt: str | None = None
    params: dict | None = None


class ModelRead(SQLModel):
    id: int
    name: str
    provider: str
    model_name: str
    base_url: str | None = None
    has_api_key: bool = False
    system_prompt: str | None = None
    params: dict | None = None
    has_runs: bool = False


class ModelUpdate(SQLModel):
    name: str | None = None
    provider: str | None = None
    model_name: str | None = None
    base_url: str | None = None
    api_key: str | None = None
    system_prompt: str | None = None
    params: dict | None = None


