from typing import Annotated
from fastapi import Depends
from sqlmodel import Session
from db import get_session
from core.auth import get_current_user
from db_models.user import User

SessionDep = Annotated[Session, Depends(get_session)]
CurrentUserDep = Annotated[User, Depends(get_current_user)]
