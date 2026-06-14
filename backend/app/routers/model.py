from fastapi import APIRouter, HTTPException, status
from sqlmodel import select

from core.model_adapter import get_model_client
from deps import SessionDep, CurrentUserDep
from db_models.model import Model
from db_models.user_api_key import UserApiKey
from schemas.model import ModelCreate, ModelRead, ModelUpdate
from core.encryption import encrypt_api_key

router = APIRouter(prefix="/models", tags=["models"])


def _to_read(m: Model, session=None) -> ModelRead:
    has_runs = False
    if session is not None:
        from db_models.experiment import ExperimentRun, StatusType
        has_runs = session.exec(
            select(ExperimentRun).where(
                ExperimentRun.model_id == m.id,
                ExperimentRun.status == StatusType.COMPLETED,
            ).limit(1)
        ).first() is not None
    return ModelRead(
        id=m.id,
        name=m.name,
        provider=m.provider,
        model_name=m.model_name,
        base_url=m.base_url,
        has_api_key=m.api_key_encrypted is not None,
        system_prompt=m.system_prompt,
        params=m.params,
        has_runs=has_runs,
    )


_NATIVE_PROVIDERS = {"openai", "anthropic", "claude", "gemini", "google"}


@router.post("/", response_model=ModelRead, status_code=status.HTTP_201_CREATED)
def create_model(payload: ModelCreate, session: SessionDep, current_user: CurrentUserDep):
    if (payload.provider or "").lower() in _NATIVE_PROVIDERS:
        payload.base_url = None

    api_key_encrypted = None
    if payload.user_api_key_id:
        saved = session.get(UserApiKey, payload.user_api_key_id)
        if not saved or saved.user_id != current_user.id:
            raise HTTPException(400, "Invalid saved API key reference")
        api_key_encrypted = saved.api_key_encrypted
    elif payload.api_key:
        api_key_encrypted = encrypt_api_key(payload.api_key)

    if not payload.base_url and not api_key_encrypted:
        raise HTTPException(400, "api_key or user_api_key_id is required when base_url is not provided")

    db_model = Model(
        name=payload.name,
        provider=payload.provider,
        model_name=payload.model_name,
        base_url=payload.base_url,
        api_key_encrypted=api_key_encrypted,
        system_prompt=payload.system_prompt,
        params=payload.params or {},
        user_id=current_user.id,
    )

    check = get_model_client(db_model).validate()
    if not check["valid"]:
        raise HTTPException(400, f"Model validation failed: {check['error']}")
    session.add(db_model)
    session.commit()
    session.refresh(db_model)
    return _to_read(db_model, session)


@router.get("/", response_model=list[ModelRead])
def list_models(session: SessionDep, current_user: CurrentUserDep):
    return [
        _to_read(m, session)
        for m in session.exec(select(Model).where(Model.user_id == current_user.id)).all()
    ]


@router.get("/{model_id}", response_model=ModelRead)
def get_model(model_id: int, session: SessionDep, current_user: CurrentUserDep):
    m = session.get(Model, model_id)
    if not m or m.user_id != current_user.id:
        raise HTTPException(404, "Model not found")
    return _to_read(m, session)


@router.patch("/{model_id}", response_model=ModelRead)
def update_model(model_id: int, payload: ModelUpdate, session: SessionDep, current_user: CurrentUserDep):
    m = session.get(Model, model_id)
    if not m or m.user_id != current_user.id:
        raise HTTPException(404, "Model not found")

    data = payload.model_dump(exclude_unset=True)

    if "provider" in data or "model_name" in data:
        raise HTTPException(400, "Provider and model name cannot be changed after creation.")

    _locked_by_runs = {"params", "system_prompt"}
    if any(f in data for f in _locked_by_runs):
        from db_models.experiment import ExperimentRun, StatusType
        has_runs = session.exec(
            select(ExperimentRun).where(
                ExperimentRun.model_id == model_id,
                ExperimentRun.status == StatusType.COMPLETED,
            ).limit(1)
        ).first()
        if has_runs:
            raise HTTPException(
                409,
                "This model has experiment runs. Only the name can be changed to preserve result integrity.",
            )

    if "api_key" in data:
        key = data.pop("api_key")
        if key:
            m.api_key_encrypted = encrypt_api_key(key)
    for k, v in data.items():
        setattr(m, k, v)

    if not m.base_url and not m.api_key_encrypted:
        raise HTTPException(400, "api_key is required when base_url is not provided")

    session.add(m)
    session.commit()
    session.refresh(m)
    return _to_read(m, session)


@router.delete("/{model_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_model(model_id: int, session: SessionDep, current_user: CurrentUserDep):
    m = session.get(Model, model_id)
    if not m or m.user_id != current_user.id:
        raise HTTPException(404, "Model not found")

    from db_models.experiment import Experiment, ExperimentRun, StatusType
    active_experiments = session.exec(
        select(Experiment).where(
            Experiment.user_id == current_user.id,
            Experiment.status.in_([StatusType.PENDING, StatusType.RUNNING]),
        )
    ).all()
    for exp in active_experiments:
        if model_id in exp.candidate_model_ids:
            raise HTTPException(409, "Model is used in a pending or running experiment.")

    has_runs = session.exec(
        select(ExperimentRun).where(
            ExperimentRun.model_id == model_id,
            ExperimentRun.status == StatusType.COMPLETED,
        ).limit(1)
    ).first()
    if has_runs:
        raise HTTPException(409, "Model has completed experiment runs and cannot be deleted.")

    session.delete(m)
    session.commit()
