from fastapi import APIRouter, HTTPException, status
from sqlmodel import select

from core.encryption import encrypt_api_key
from db_models.user_api_key import UserApiKey
from deps import CurrentUserDep, SessionDep
from schemas.user_api_key import UserApiKeyCreate, UserApiKeyRead

router = APIRouter(prefix="/api-keys", tags=["api-keys"])


def _to_read(k: UserApiKey) -> UserApiKeyRead:
    return UserApiKeyRead(
        id=k.id,
        vendor=k.vendor,
        label=k.label,
        masked=k.masked,
        created_at=k.created_at,
    )


@router.get("/", response_model=list[UserApiKeyRead])
def list_keys(session: SessionDep, current_user: CurrentUserDep):
    keys = session.exec(
        select(UserApiKey).where(UserApiKey.user_id == current_user.id)
    ).all()
    return [_to_read(k) for k in keys]


@router.post("/", response_model=UserApiKeyRead, status_code=status.HTTP_201_CREATED)
def create_key(payload: UserApiKeyCreate, session: SessionDep, current_user: CurrentUserDep):
    raw = payload.api_key.strip()
    if not raw:
        raise HTTPException(400, "api_key cannot be empty")
    if not payload.label.strip():
        raise HTTPException(400, "label cannot be empty")
    if not payload.vendor.strip():
        raise HTTPException(400, "vendor cannot be empty")

    masked = "..." + raw[-4:] if len(raw) >= 4 else "****"
    key = UserApiKey(
        user_id=current_user.id,
        vendor=payload.vendor,
        label=payload.label,
        api_key_encrypted=encrypt_api_key(raw),
        masked=masked,
    )
    session.add(key)
    session.commit()
    session.refresh(key)
    return _to_read(key)


@router.delete("/{key_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_key(key_id: int, session: SessionDep, current_user: CurrentUserDep):
    key = session.get(UserApiKey, key_id)
    if not key or key.user_id != current_user.id:
        raise HTTPException(404, "API key not found")
    session.delete(key)
    session.commit()
