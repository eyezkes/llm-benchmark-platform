from typing import Optional
from pathlib import Path
import io

from fastapi import APIRouter, HTTPException, status, UploadFile, File, Form
from fastapi.responses import StreamingResponse
from sqlmodel import select

from deps import SessionDep, CurrentUserDep
from db_models.dataset import Dataset, DatasetType
from schemas.dataset import DatasetMapRequest, DatasetRead, DatasetUpdate
from services.dataset_service import DatasetService

router = APIRouter(prefix="/datasets", tags=["datasets"])


@router.post("/upload", response_model=DatasetRead, status_code=status.HTTP_201_CREATED)
async def upload_dataset(
    session: SessionDep,
    current_user: CurrentUserDep,
    name: str = Form(...),
    dataset_type: DatasetType = Form(...),
    description: Optional[str] = Form(None),
    file: UploadFile = File(...),
):
    service = DatasetService(session)
    return await service.upload_dataset(name, dataset_type, description, file, user_id=current_user.id)


@router.get("/{dataset_id}/columns", response_model=list[str])
def get_columns(dataset_id: int, session: SessionDep, current_user: CurrentUserDep):
    d = session.get(Dataset, dataset_id)
    if not d or d.user_id != current_user.id:
        raise HTTPException(404, "Dataset not found")
    service = DatasetService(session)
    return service.get_columns(dataset_id)


@router.post("/{dataset_id}/map", response_model=DatasetRead)
def map_columns(dataset_id: int, payload: DatasetMapRequest, session: SessionDep, current_user: CurrentUserDep):
    d = session.get(Dataset, dataset_id)
    if not d or d.user_id != current_user.id:
        raise HTTPException(404, "Dataset not found")
    service = DatasetService(session)
    return service.map_columns(
        dataset_id,
        {
            "question_id": payload.question_id,
            "question": payload.question,
            "options": payload.options,
            "true_answer": payload.true_answer,
            "category": payload.category,
        },
    )


@router.get("/", response_model=list[DatasetRead])
def list_datasets(session: SessionDep, current_user: CurrentUserDep):
    return session.exec(select(Dataset).where(Dataset.user_id == current_user.id)).all()


@router.get("/{dataset_id}", response_model=DatasetRead)
def get_dataset(dataset_id: int, session: SessionDep, current_user: CurrentUserDep):
    d = session.get(Dataset, dataset_id)
    if not d or d.user_id != current_user.id:
        raise HTTPException(404, "Dataset not found")
    return d


@router.get("/{dataset_id}/download")
def download_dataset(dataset_id: int, session: SessionDep, current_user: CurrentUserDep):
    d = session.get(Dataset, dataset_id)
    if not d or d.user_id != current_user.id:
        raise HTTPException(404, "Dataset not found")

    file_path = Path(d.file_path)
    if not file_path.exists():
        raise HTTPException(404, "Dataset file not found on server")

    ext = file_path.suffix.lower()
    if ext == ".csv":
        content = file_path.read_bytes()
        return StreamingResponse(
            io.BytesIO(content),
            media_type="text/csv",
            headers={"Content-Disposition": f'attachment; filename="{d.name}.csv"'},
        )
    elif ext == ".jsonl":
        import pandas as pd
        df = pd.read_json(file_path, lines=True)
        buf = io.StringIO()
        df.to_csv(buf, index=False)
        return StreamingResponse(
            io.BytesIO(buf.getvalue().encode("utf-8")),
            media_type="text/csv",
            headers={"Content-Disposition": f'attachment; filename="{d.name}.csv"'},
        )
    else:
        raise HTTPException(400, f"Unsupported file format: {ext}")


@router.patch("/{dataset_id}", response_model=DatasetRead)
def update_dataset(dataset_id: int, payload: DatasetUpdate, session: SessionDep, current_user: CurrentUserDep):
    d = session.get(Dataset, dataset_id)
    if not d or d.user_id != current_user.id:
        raise HTTPException(404, "Dataset not found")
    for k, v in payload.model_dump(exclude_unset=True).items():
        setattr(d, k, v)
    session.add(d)
    session.commit()
    session.refresh(d)
    return d


@router.delete("/{dataset_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_dataset(dataset_id: int, session: SessionDep, current_user: CurrentUserDep):
    d = session.get(Dataset, dataset_id)
    if not d or d.user_id != current_user.id:
        raise HTTPException(404, "Dataset not found")

    from db_models.experiment import Experiment
    experiments = session.exec(
        select(Experiment).where(Experiment.dataset_id == dataset_id)
    ).all()
    if experiments:
        raise HTTPException(409, "Dataset is used in experiments. Delete them first.")

    session.delete(d)
    session.commit()

    try:
        Path(d.file_path).unlink(missing_ok=True)
    except Exception:
        pass
