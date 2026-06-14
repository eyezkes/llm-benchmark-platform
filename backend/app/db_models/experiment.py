from datetime import datetime, timezone
from enum import Enum
from typing import List
from sqlalchemy import Column
from sqlalchemy.types import JSON
from sqlmodel import SQLModel, Field


class StatusType(str, Enum):
    PENDING = "pending"
    RUNNING = "running"
    COMPLETED = "completed"
    FAILED = "failed"
    CANCELLED = "cancelled"


class JudgeType(str, Enum):
    EQUALS = "equals"
    CONTAINS = "contains"
    JSON_EQUALITY = "json_equals"
    LLM_SCORE = "llm_score"
    LLM_BOOL = "llm_bool"
    SIMILARITY = "similarity"


# ── Judge config (stored as JSON inside Experiment) ──────────────────
# Each entry: {"judge_type": "equals"} or {"judge_type": "llm_score", "judge_model_id": 3}


class Experiment(SQLModel, table=True):
    __table_args__ = {'extend_existing': True}
    id: int | None = Field(default=None, primary_key=True)
    name: str

    dataset_id: int = Field(foreign_key="dataset.id")
    candidate_model_ids: List[int] = Field(
        default_factory=list, sa_column=Column(JSON, nullable=False)
    )
    judge_configs: list = Field(
        default_factory=list, sa_column=Column(JSON, nullable=False)
    )  # [{"judge_type": "equals"}, {"judge_type": "llm_score", "judge_model_id": 3}]

    description: str | None = None
    system_prompt_override: str | None = None
    sample_size: int
    seed: int = 42
    measure_k: int = 0

    status: StatusType = Field(default=StatusType.PENDING, index=True)
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    updated_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    user_id: int = Field(foreign_key="users.id", index=True)


class ExperimentRun(SQLModel, table=True):
    __table_args__ = {'extend_existing': True}
    """One run = one candidate model × one judge for a given experiment."""

    id: int | None = Field(default=None, primary_key=True)
    experiment_id: int = Field(foreign_key="experiment.id", index=True)
    model_id: int = Field(foreign_key="model.id")
    judge_type: JudgeType
    judge_model_id: int | None = Field(default=None, foreign_key="judgemodel.id")

    status: StatusType = Field(default=StatusType.PENDING, index=True)

    # ── bool-eval metrics ──
    accuracy: float | None = None
    correct_count: int | None = None

    # ── score-eval metrics ──
    average_score: float | None = None
    normalized_average_score: float | None = None

    # ── shared metrics ──
    evaluated_count: int | None = None
    invalid_count: int | None = None

    # ── latency ──
    e2e_response_time_ms: float | None = None
    e2e_response_time_median_ms: float | None = None
    e2e_response_time_p95_ms: float | None = None
    latency_ttft_ms: float | None = None
    latency_ttft_median_ms: float | None = None
    latency_ttft_p95_ms: float | None = None
    latency_sample_count: int | None = None
    latency_measure_k: int | None = None
    prompt_tokens: int | None = None
    completion_tokens: int | None = None
    total_tokens: int | None = None
    estimated_cost_usd: float | None = None
    pricing_model_id: str | None = None
    pricing_source: str | None = None
    token_count_method: str | None = None


    # ── category dict ──
    category_metrics: dict | None = Field(
        default=None, sa_column=Column(JSON, nullable=True)
    )

    # ── similarity metrics (BLEU, ROUGE-L, CER, Semantic Similarity, Perplexity) ──
    similarity_metrics: dict | None = Field(
        default=None, sa_column=Column(JSON, nullable=True)
    )

    # ── output files ──
    answers_path: str | None = None
    metrics_path: str | None = None

    # ── failure reason ──
    error_message: str | None = None
