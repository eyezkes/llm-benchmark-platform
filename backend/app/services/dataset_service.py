from __future__ import annotations

import json
import uuid
from pathlib import Path
from typing import Optional, Set

import pandas as pd
from fastapi import HTTPException, UploadFile
from sqlmodel import Session

from db_models.dataset import Dataset, DatasetType, DatasetStatus

DATASETS_DIR = Path(__file__).resolve().parent.parent.parent / "data" / "datasets"
ALLOWED_EXTENSIONS = {".csv", ".jsonl"}

REQUIRED_ROLES: dict[DatasetType, Set[str]] = {
    DatasetType.NO_TRUE_ANSWER: { "question"},
    DatasetType.OPEN_WITH_TRUE: { "question", "true_answer"},
    DatasetType.MC_WITH_TRUE: { "question", "options", "true_answer"},
}


class DatasetService:
    def __init__(self, session: Session) -> None:
        self.session = session

    # ── Upload ────────────────────────────────────────────────────────

    async def upload_dataset(
        self,
        name: str,
        dataset_type: DatasetType,
        description: Optional[str],
        file: UploadFile,
        user_id: int,
    ) -> Dataset:
        ext = Path(file.filename or "").suffix.lower()
        if ext not in ALLOWED_EXTENSIONS:
            raise HTTPException(400, f"Unsupported file type: {ext}")

        DATASETS_DIR.mkdir(parents=True, exist_ok=True)
        file_name = f"{uuid.uuid4().hex}{ext}"
        file_path = DATASETS_DIR / file_name

        content = await file.read()
        file_path.write_bytes(content)

        dataset = Dataset(
            name=name,
            dataset_type=dataset_type,
            description=description,
            file_path=str(file_path),
            status=DatasetStatus.UPLOADED,
            number_of_questions=0,
            user_id=user_id,
        )

        # Auto-map if columns match standard names
        df = self._load_df(dataset)
        auto_map = self._try_auto_map(df, dataset_type)
        if auto_map:
            dataset.column_mapping = auto_map
            dataset.number_of_questions = int(
                self._non_empty_mask(df[auto_map["question"]]).sum()
            )
            dataset.status = DatasetStatus.READY
        self.session.add(dataset)
        self.session.commit()
        self.session.refresh(dataset)
        return dataset

    # ── Column mapping ────────────────────────────────────────────────

    def get_columns(self, dataset_id: int) -> list[str]:
        dataset = self._get_or_404(dataset_id)
        df = self._load_df(dataset)
        return list(df.columns)

    def map_columns(self, dataset_id: int, mapping: dict[str, str | None]) -> Dataset:
        dataset = self._get_or_404(dataset_id)
        df = self._load_df(dataset)

        clean_map = {k: v for k, v in mapping.items() if v is not None}

        # Auto-generate question_id if not mapped
        if "question_id" not in clean_map:
            df["_auto_question_id"] = range(1, len(df) + 1)
            ext = Path(dataset.file_path).suffix.lower()
            if ext == ".jsonl":
                df.to_json(dataset.file_path, orient="records", lines=True, force_ascii=False)
            else:
                df.to_csv(dataset.file_path, index=False)
            clean_map["question_id"] = "_auto_question_id"

        self._validate_mapping(df, dataset.dataset_type, clean_map)

        # Validate options column for MC datasets
        if dataset.dataset_type == DatasetType.MC_WITH_TRUE and "options" in clean_map:
            self._validate_options_column(df, clean_map["options"])

        q_col = clean_map["question"]
        count = int(self._non_empty_mask(df[q_col]).sum())

        dataset.column_mapping = clean_map
        dataset.number_of_questions = count
        dataset.status = DatasetStatus.READY

        self.session.add(dataset)
        self.session.commit()
        self.session.refresh(dataset)
        return dataset

    # ── Helpers ────────────────────────────────────────────────────────

    def _get_or_404(self, dataset_id: int) -> Dataset:
        d = self.session.get(Dataset, dataset_id)
        if not d:
            raise HTTPException(404, "Dataset not found")
        return d

    def _load_df(self, dataset: Dataset) -> pd.DataFrame:
        path = Path(dataset.file_path)
        ext = path.suffix.lower()
        if ext == ".csv":
            df = pd.read_csv(path)
        elif ext == ".jsonl":
            df = pd.read_json(path, lines=True)
        else:
            raise HTTPException(400, f"Unsupported file: {ext}")
        return self._normalize_list_columns(df)

    def _normalize_list_columns(self, df: pd.DataFrame) -> pd.DataFrame:
        """Convert list-type cells to JSON strings so validation works uniformly for JSONL and CSV."""
        for col in df.columns:
            if df[col].apply(lambda x: isinstance(x, list)).any():
                df[col] = df[col].apply(
                    lambda x: json.dumps(x, ensure_ascii=False) if isinstance(x, list) else x
                )
        return df

    def _non_empty_mask(self, series: pd.Series) -> pd.Series:
        return series.notna() & series.astype(str).str.strip().ne("")

    def _validate_mapping(
        self, df: pd.DataFrame, dtype: DatasetType, mapping: dict[str, str]
    ) -> None:
        required = REQUIRED_ROLES[dtype]

        missing_roles = [r for r in required if r not in mapping]
        if missing_roles:
            raise HTTPException(400, f"Missing required mappings: {missing_roles}")

        missing_cols = [mapping[r] for r in required if mapping[r] not in df.columns]
        if missing_cols:
            raise HTTPException(400, f"Columns not found in file: {missing_cols}")

        # Basic non-empty checks
        q_col = mapping["question"]
        if not self._non_empty_mask(df[q_col]).any():
            raise HTTPException(400, "question column is entirely empty.")

        if "true_answer" in required:
            if not self._non_empty_mask(df[mapping["true_answer"]]).any():
                raise HTTPException(400, "true_answer column is entirely empty.")

    def _validate_options_column(self, df: pd.DataFrame, col: str) -> None:
        """Options must be a JSON array string in every row, e.g. '["A) Paris","B) London"]'."""
        for idx, val in df[col].items():
            try:
                parsed = json.loads(str(val))
                if not isinstance(parsed, list) or len(parsed) < 2:
                    raise ValueError
            except (json.JSONDecodeError, ValueError):
                raise HTTPException(
                    400,
                    f"Row {idx}: options column must be a JSON array with ≥2 items. "
                    f"Got: {str(val)[:100]}",
                )


    STANDARD_NAMES: dict[str, list[str]] = {
        "question_id": ["question_id", "q_id", "id", "qid"],
        "question": ["question", "prompt", "text", "query"],
        "options": ["options", "choices"],
        "true_answer": ["true_answer", "answer", "correct_answer", "ground_truth"],
        "category": ["category", "cat", "topic", "subject"],
    }

    def _try_auto_map(self, df: pd.DataFrame, dtype: DatasetType) -> dict | None:
        """If CSV columns match standard names, return mapping automatically."""
        cols = set(df.columns)
        mapping = {}

        for role, variants in self.STANDARD_NAMES.items():
            for v in variants:
                if v in cols:
                    mapping[role] = v
                    break

        # Check required roles are present
        required = REQUIRED_ROLES[dtype]
        if not all(r in mapping for r in required):
            return None

        # For MC, validate options column
        if dtype == DatasetType.MC_WITH_TRUE and "options" in mapping:
            try:
                self._validate_options_column(df, mapping["options"])
            except HTTPException:
                return None

        return mapping
