from fastapi import APIRouter, HTTPException, status
from sqlmodel import select

from core.model_adapter import get_model_client
from deps import SessionDep, CurrentUserDep
from db_models.model import JudgeModel, JudgeMode
from db_models.user_api_key import UserApiKey
from schemas.judge_model import JudgeModelCreate, JudgeModelRead, JudgeModelUpdate
from core.encryption import encrypt_api_key

router = APIRouter(prefix="/judge-models", tags=["judge-models"])


def _validate_mode(mode, score_min, score_max, correct_tokens, incorrect_tokens):
    if mode == JudgeMode.SCORE:
        if score_min is None or score_max is None:
            raise HTTPException(400, "score_min and score_max required for score mode")
        if score_min >= score_max:
            raise HTTPException(400, "score_min must be < score_max")
    elif mode == JudgeMode.BOOLEAN:
        if not correct_tokens or not incorrect_tokens:
            raise HTTPException(400, "correct_tokens and incorrect_tokens required for boolean mode")


def _to_read(j: JudgeModel, session=None) -> JudgeModelRead:
    has_runs = False
    if session is not None:
        from db_models.experiment import ExperimentRun
        has_runs = session.exec(
            select(ExperimentRun).where(ExperimentRun.judge_model_id == j.id).limit(1)
        ).first() is not None
    return JudgeModelRead(
        id=j.id, name=j.name, provider=j.provider, model_name=j.model_name,
        base_url=j.base_url, has_api_key=j.api_key_encrypted is not None,
        system_prompt=j.system_prompt, params=j.params, mode=j.mode,
        score_min=j.score_min, score_max=j.score_max,
        correct_tokens=j.correct_tokens, incorrect_tokens=j.incorrect_tokens,
        has_runs=has_runs,
    )


@router.post("/", response_model=JudgeModelRead, status_code=status.HTTP_201_CREATED)
def create_judge_model(payload: JudgeModelCreate, session: SessionDep, current_user: CurrentUserDep):
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

    _validate_mode(payload.mode, payload.score_min, payload.score_max,
                   payload.correct_tokens, payload.incorrect_tokens)
    j = JudgeModel(
        name=payload.name, provider=payload.provider, model_name=payload.model_name,
        base_url=payload.base_url,
        api_key_encrypted=api_key_encrypted,
        system_prompt=payload.system_prompt, params=payload.params or {},
        mode=payload.mode, score_min=payload.score_min, score_max=payload.score_max,
        correct_tokens=payload.correct_tokens, incorrect_tokens=payload.incorrect_tokens,
        user_id=current_user.id,
    )

    check = get_model_client(j).validate()
    if not check["valid"]:
        raise HTTPException(400, f"Model validation failed: {check['error']}")

    session.add(j)
    session.commit()
    session.refresh(j)
    return _to_read(j, session)


@router.get("/", response_model=list[JudgeModelRead])
def list_judge_models(session: SessionDep, current_user: CurrentUserDep):
    return [
        _to_read(j, session)
        for j in session.exec(select(JudgeModel).where(JudgeModel.user_id == current_user.id)).all()
    ]


@router.get("/{judge_id}", response_model=JudgeModelRead)
def get_judge_model(judge_id: int, session: SessionDep, current_user: CurrentUserDep):
    j = session.get(JudgeModel, judge_id)
    if not j or j.user_id != current_user.id:
        raise HTTPException(404, "Judge model not found")
    return _to_read(j, session)


_JUDGE_LOCKED_BY_RUNS = {"params", "system_prompt", "mode", "score_min", "score_max",
                         "correct_tokens", "incorrect_tokens"}


@router.patch("/{judge_id}", response_model=JudgeModelRead)
def update_judge_model(judge_id: int, payload: JudgeModelUpdate, session: SessionDep, current_user: CurrentUserDep):
    j = session.get(JudgeModel, judge_id)
    if not j or j.user_id != current_user.id:
        raise HTTPException(404, "Judge model not found")

    data = payload.model_dump(exclude_unset=True)

    if "provider" in data or "model_name" in data:
        raise HTTPException(400, "Provider and model name cannot be changed after creation.")

    if any(f in data for f in _JUDGE_LOCKED_BY_RUNS):
        from db_models.experiment import ExperimentRun
        has_runs = session.exec(
            select(ExperimentRun).where(ExperimentRun.judge_model_id == judge_id).limit(1)
        ).first()
        if has_runs:
            raise HTTPException(
                409,
                "This judge has experiment runs. Only the name can be changed to preserve result integrity.",
            )

    if "api_key" in data:
        key = data.pop("api_key")
        if key:
            j.api_key_encrypted = encrypt_api_key(key)

    for k, v in data.items():
        setattr(j, k, v)

    _validate_mode(j.mode, j.score_min, j.score_max, j.correct_tokens, j.incorrect_tokens)

    if not j.base_url and not j.api_key_encrypted:
        raise HTTPException(400, "api_key is required when base_url is not provided")

    session.add(j)
    session.commit()
    session.refresh(j)
    return _to_read(j, session)


@router.delete("/{judge_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_judge_model(judge_id: int, session: SessionDep, current_user: CurrentUserDep):
    j = session.get(JudgeModel, judge_id)
    if not j or j.user_id != current_user.id:
        raise HTTPException(404, "Judge model not found")

    from db_models.experiment import Experiment, ExperimentRun, StatusType
    active_experiments = session.exec(
        select(Experiment).where(
            Experiment.user_id == current_user.id,
            Experiment.status.in_([StatusType.PENDING, StatusType.RUNNING]),
        )
    ).all()
    for exp in active_experiments:
        if any(cfg.get("judge_model_id") == judge_id for cfg in exp.judge_configs):
            raise HTTPException(409, "Judge model is used in a pending or running experiment.")

    run_using_judge = session.exec(
        select(ExperimentRun).where(ExperimentRun.judge_model_id == judge_id)
    ).first()
    if run_using_judge:
        raise HTTPException(409, "Judge model is referenced by existing experiment runs.")

    session.delete(j)
    session.commit()

