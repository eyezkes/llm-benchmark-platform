from datetime import datetime
from typing import List
from pydantic import BaseModel
from sqlmodel import SQLModel
from db_models.experiment import StatusType, JudgeType


class JudgeConfig(BaseModel):
    judge_type: JudgeType
    judge_model_id: int | None = None  # required for llm_score / llm_bool


class ExperimentCreate(SQLModel):
    name: str
    description: str | None = None
    system_prompt_override: str | None = None
    dataset_id: int
    candidate_model_ids: List[int]
    judge_configs: List[JudgeConfig]
    sample_size: int | None = 1
    seed: int = 42
    measure_k: int | None = 0


class ExperimentUpdate(SQLModel):
    name: str | None = None
    description: str | None = None
    system_prompt_override: str | None = None
    sample_size: int | None = None
    seed: int | None = None
    measure_k: int | None = None


class ExperimentRunRead(SQLModel):
    id: int
    experiment_id: int
    model_id: int
    judge_type: JudgeType
    judge_model_id: int | None = None
    status: StatusType
    accuracy: float | None = None
    correct_count: int | None = None
    average_score: float | None = None
    normalized_average_score: float | None = None
    evaluated_count: int | None = None
    invalid_count: int | None = None
    e2e_response_time_ms: float | None = None
    e2e_response_time_median_ms: float | None = None
    e2e_response_time_p95_ms: float | None = None
    latency_ttft_ms: float | None = None
    latency_ttft_median_ms: float | None = None
    latency_ttft_p95_ms: float | None = None
    latency_sample_count: int | None = None
    latency_measure_k: int | None = None
    category_metrics: dict | None = None
    prompt_tokens: int | None = None
    completion_tokens: int | None = None
    total_tokens: int | None = None
    estimated_cost_usd: float | None = None
    pricing_model_id: str | None = None
    pricing_source: str | None = None
    token_count_method: str | None = None
    answers_path: str | None = None
    metrics_path: str | None = None
    error_message: str | None = None
    similarity_metrics: dict | None = None


class ExperimentRead(SQLModel):
    id: int
    name: str
    description: str | None = None
    system_prompt_override: str | None = None
    dataset_id: int
    candidate_model_ids: List[int]
    judge_configs: list
    sample_size: int
    seed: int
    measure_k: int | None
    status: StatusType
    created_at: datetime
    updated_at: datetime
    prompt_tokens: int | None = None
    completion_tokens: int | None = None
    total_tokens: int | None = None
    estimated_cost_usd: float | None = None
    runs: List[ExperimentRunRead] = []


class AnalyzeRequest(BaseModel):
    model_id: int
