import logging

from fastapi import APIRouter, HTTPException, status
from jose import JWTError, jwt
from sqlmodel import select

from config import get_settings
from deps import SessionDep, CurrentUserDep
from db_models.user import User
from schemas.user import UserCreate, UserRead, ChangePassword, RefreshTokenRequest
from core.auth import (
    ALGORITHM,
    hash_password,
    verify_password,
    create_access_token,
    create_refresh_token,
)

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/auth", tags=["auth"])


@router.post("/register", status_code=status.HTTP_201_CREATED)
def register(payload: UserCreate, session: SessionDep):
    existing = session.exec(select(User).where(User.email == payload.email)).first()
    if existing:
        logger.warning("Register failed — email already in use: %s", payload.email)
        raise HTTPException(400, "Email already registered")
    user = User(email=payload.email, hashed_password=hash_password(payload.password))
    session.add(user)
    session.commit()
    session.refresh(user)
    logger.info("New user registered: %s (id=%d)", user.email, user.id)
    return {
        "access_token": create_access_token(user.id),
        "refresh_token": create_refresh_token(user.id),
        "token_type": "bearer",
    }


@router.post("/login")
def login(payload: UserCreate, session: SessionDep):
    user = session.exec(select(User).where(User.email == payload.email)).first()
    if not user or not verify_password(payload.password, user.hashed_password):
        logger.warning("Login failed — invalid credentials for: %s", payload.email)
        raise HTTPException(401, "Invalid credentials")
    logger.info("User logged in: %s (id=%d)", user.email, user.id)
    return {
        "access_token": create_access_token(user.id),
        "refresh_token": create_refresh_token(user.id),
        "token_type": "bearer",
    }


@router.get("/me", response_model=UserRead)
def me(current_user: CurrentUserDep):
    return current_user


@router.post("/change-password")
def change_password(payload: ChangePassword, current_user: CurrentUserDep, session: SessionDep):
    if not verify_password(payload.old_password, current_user.hashed_password):
        raise HTTPException(400, "Old password is incorrect")
    if len(payload.new_password) < 8:
        raise HTTPException(400, "New password must be at least 8 characters")
    current_user.hashed_password = hash_password(payload.new_password)
    session.add(current_user)
    session.commit()
    return {"message": "Password changed successfully"}


@router.post("/refresh")
def refresh(payload: RefreshTokenRequest):
    credentials_exception = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Invalid or expired refresh token",
    )
    try:
        data = jwt.decode(
            payload.refresh_token,
            get_settings().jwt_secret_key,
            algorithms=[ALGORITHM],
        )
        if data.get("type") != "refresh":
            raise credentials_exception
        user_id = int(data["sub"])
    except (JWTError, KeyError, ValueError):
        raise credentials_exception
    return {"access_token": create_access_token(user_id), "token_type": "bearer"}


@router.post("/logout")
def logout(current_user: CurrentUserDep):
    return {"message": "Logged out successfully"}
