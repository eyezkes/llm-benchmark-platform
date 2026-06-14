from fastapi import APIRouter, HTTPException, status
from sqlmodel import select, or_, SQLModel

from deps import SessionDep, CurrentUserDep
from db_models.prompt import Prompt, PromptType
from db_models.dataset import DatasetType
from db_models.model import JudgeMode
from db_models.experiment import JudgeType
from db_models.user_api_key import UserApiKey
from schemas.prompt import PromptCreate, PromptRead, PromptUpdate
from core.model_client import ModelClient
from core.model_adapter import VendorModelClient, VENDOR_BY_PROVIDER

router = APIRouter(prefix="/prompts", tags=["prompts"])


# ── helpers ──────────────────────────────────────────────────────────────────

def _to_read(p: Prompt) -> PromptRead:
    return PromptRead(
        id=p.id,
        name=p.name,
        content=p.content,
        prompt_type=p.prompt_type,
        dataset_type=DatasetType(p.dataset_type) if p.dataset_type else None,
        eval_type=JudgeType(p.eval_type) if p.eval_type else None,
        is_builtin=p.is_builtin,
        user_id=p.user_id,
        judge_mode=JudgeMode(p.judge_mode) if p.judge_mode else None,
        score_min=p.score_min,
        score_max=p.score_max,
        correct_tokens=p.correct_tokens,
        incorrect_tokens=p.incorrect_tokens,
    )


_DATASET_DESC = {
    "mc_with_true": "multiple-choice questions where each question has a single correct letter answer (A/B/C/D)",
    "open_with_true": "open-ended questions that have a known correct reference answer",
    "no_true_answer": "open-ended tasks with no single correct answer (e.g. summarization, translation, generation)",
}

_EVAL_DESC = {
    "equals": "exact-match — the model output is compared character-for-character against the true answer",
    "contains": "substring-match — the true answer must appear somewhere in the model output",
    "json_equals": "JSON equality — the model output is parsed as JSON and compared structurally",
    "similarity": "lexical similarity — BLEU/ROUGE n-gram overlap against the reference",
    "llm_bool": "LLM boolean judge — a separate judge model decides correct/incorrect",
    "llm_score": "LLM score judge — a separate judge model assigns a numeric score",
}


def _build_meta_prompt(
    prompt_type: str,
    dataset_type: str | None,
    eval_type: str | None,
    judge_mode: str | None,
    score_min: float | None,
    score_max: float | None,
    correct_tokens: list[str] | None,
    incorrect_tokens: list[str] | None,
) -> str:
    lines: list[str] = [
        "You are an expert prompt engineer for an LLM evaluation platform.",
        "Your task is to write a system prompt based on the user's description.",
        "Output ONLY the system prompt text — no preamble, no explanation, no markdown fences.",
        "",
    ]

    if prompt_type == "judge":
        lines += [
            "## Role",
            "This prompt will be given to a JUDGE model that evaluates another model's responses.",
            "",
            "## Message format the judge receives",
            "The judge always receives a user message structured like this:",
            "  Question:\\n{question}\\n\\nReference (ground truth):\\n{reference}\\n\\nModel Answer:\\n{model_answer}",
            "Note: the 'Reference' block is omitted when there is no ground truth.",
            "",
        ]

        if judge_mode == "boolean":
            ct = ", ".join(f'"{t}"' for t in (correct_tokens or ["yes"])) or '"yes"'
            it = ", ".join(f'"{t}"' for t in (incorrect_tokens or ["no"])) or '"no"'
            lines += [
                "## Output constraint — CRITICAL",
                f"The judge must respond with ONLY one of these exact tokens:",
                f"  Correct verdict tokens: {ct}",
                f"  Incorrect verdict tokens: {it}",
                "The prompt MUST instruct the judge to reply with exactly one of those tokens and nothing else.",
                "Do NOT ask the judge to explain its reasoning.",
                "",
            ]
        elif judge_mode == "score":
            lo = score_min if score_min is not None else 1
            hi = score_max if score_max is not None else 5
            lines += [
                "## Output constraint — CRITICAL",
                f"The judge must respond with ONLY a single integer or decimal number between {lo} and {hi}.",
                "The prompt MUST instruct the judge to reply with just the number and nothing else.",
                f"Include a short rubric describing what scores {lo} (worst) through {hi} (best) mean.",
                "Do NOT ask the judge to explain its reasoning beyond the rubric.",
                "",
            ]

        if dataset_type and dataset_type in _DATASET_DESC:
            lines += [
                "## Dataset context",
                f"The evaluated responses come from {_DATASET_DESC[dataset_type]}.",
                "",
            ]

    else:  # model prompt
        lines += [
            "## Role",
            "This prompt will be given as the SYSTEM PROMPT to a model being evaluated.",
            "",
        ]

        if eval_type in ("equals", "contains"):
            lines += [
                "## Output constraint — CRITICAL",
                f"Evaluation method: {_EVAL_DESC.get(eval_type, eval_type)}.",
                "The model's output will be compared programmatically — extra words, punctuation, or explanations will cause failures.",
                "The system prompt MUST instruct the model to output ONLY the bare answer (e.g. just the letter, just the word) with no surrounding text.",
                "",
            ]
        elif eval_type == "json_equals":
            lines += [
                "## Output constraint — CRITICAL",
                "Evaluation method: JSON equality — the output is parsed as JSON.",
                "The system prompt MUST instruct the model to output valid JSON only, with no markdown fences or surrounding text.",
                "",
            ]
        elif eval_type == "similarity":
            lines += [
                "## Evaluation context",
                "Evaluation method: lexical similarity (BLEU/ROUGE n-gram overlap).",
                "The system prompt should encourage the model to use phrasing close to the expected reference answer.",
                "",
            ]
        elif eval_type in ("llm_bool", "llm_score"):
            lines += [
                "## Evaluation context",
                f"Evaluation method: {_EVAL_DESC.get(eval_type, eval_type)}.",
                "A judge model will read the question, reference, and this model's answer to score it.",
                "",
            ]

        if dataset_type and dataset_type in _DATASET_DESC:
            lines += [
                "## Dataset context",
                f"The model will answer {_DATASET_DESC[dataset_type]}.",
                "",
            ]

    lines += [
        "## Instructions",
        "Write the system prompt now based on the user's description below.",
        "Keep it concise and precise. Do not repeat these instructions inside the prompt.",
    ]

    return "\n".join(lines)


# ── routes ───────────────────────────────────────────────────────────────────

@router.get("/", response_model=list[PromptRead])
def list_prompts(
    session: SessionDep,
    current_user: CurrentUserDep,
    dataset_type: DatasetType | None = None,
    prompt_type: PromptType | None = None,
    eval_type: JudgeType | None = None,
):
    query = select(Prompt).where(
        or_(Prompt.is_builtin == True, Prompt.user_id == current_user.id)  # noqa: E712
    )
    if dataset_type is not None:
        query = query.where(
            or_(Prompt.dataset_type == dataset_type.value, Prompt.dataset_type == None)  # noqa: E711
        )
    if eval_type is not None:
        query = query.where(
            or_(Prompt.eval_type == eval_type.value, Prompt.eval_type == None)  # noqa: E711
        )
    if prompt_type is not None:
        query = query.where(Prompt.prompt_type == prompt_type)
    return [_to_read(p) for p in session.exec(query.order_by(Prompt.is_builtin.desc(), Prompt.id)).all()]


class PromptGenerateRequest(SQLModel):
    vendor: str
    model_name: str
    api_key_id: int | None = None
    base_url: str | None = None
    prompt_type: PromptType
    dataset_type: DatasetType | None = None
    eval_type: JudgeType | None = None
    judge_mode: JudgeMode | None = None
    score_min: float | None = None
    score_max: float | None = None
    correct_tokens: list[str] | None = None
    incorrect_tokens: list[str] | None = None
    description: str


@router.post("/generate", response_model=dict)
def generate_prompt(
    payload: PromptGenerateRequest,
    session: SessionDep,
    current_user: CurrentUserDep,
):
    api_key_encrypted: str | None = None
    base_url: str | None = payload.base_url

    if payload.api_key_id is not None:
        key_row = session.get(UserApiKey, payload.api_key_id)
        if not key_row or key_row.user_id != current_user.id:
            raise HTTPException(404, "API key not found")
        api_key_encrypted = key_row.api_key_encrypted
    elif not base_url:
        raise HTTPException(400, "Provide api_key_id or base_url")

    meta_system = _build_meta_prompt(
        prompt_type=payload.prompt_type.value,
        dataset_type=payload.dataset_type.value if payload.dataset_type else None,
        eval_type=payload.eval_type.value if payload.eval_type else None,
        judge_mode=payload.judge_mode.value if payload.judge_mode else None,
        score_min=payload.score_min,
        score_max=payload.score_max,
        correct_tokens=payload.correct_tokens,
        incorrect_tokens=payload.incorrect_tokens,
    )

    try:
        vendor_enum = VENDOR_BY_PROVIDER.get((payload.vendor or "").lower())
        if vendor_enum is not None:
            client = VendorModelClient(
                model_name=payload.model_name,
                vendor=vendor_enum,
                api_key_encrypted=api_key_encrypted,
                base_url=base_url,
                system_prompt=meta_system,
                params={"temperature": 0.7},
            )
        else:
            client = ModelClient(
                model_name=payload.model_name,
                api_key_encrypted=api_key_encrypted,
                base_url=base_url,
                system_prompt=meta_system,
                params={"temperature": 0.7},
            )
        response = client.generate(payload.description)
    except Exception as e:
        raise HTTPException(502, f"Model call failed: {e}")

    return {"content": response.content.strip()}


@router.post("/", response_model=PromptRead, status_code=status.HTTP_201_CREATED)
def create_prompt(payload: PromptCreate, session: SessionDep, current_user: CurrentUserDep):
    if payload.prompt_type == PromptType.JUDGE:
        if payload.judge_mode is None:
            raise HTTPException(400, "judge_mode is required for judge prompts")
        if payload.judge_mode == JudgeMode.SCORE:
            if payload.score_min is None or payload.score_max is None:
                raise HTTPException(400, "score_min and score_max are required for score judge prompts")
            if payload.score_min >= payload.score_max:
                raise HTTPException(400, "score_min must be less than score_max")
        elif payload.judge_mode == JudgeMode.BOOLEAN:
            if not payload.correct_tokens or not payload.incorrect_tokens:
                raise HTTPException(400, "correct_tokens and incorrect_tokens are required for boolean judge prompts")

    p = Prompt(
        name=payload.name,
        content=payload.content,
        prompt_type=payload.prompt_type,
        dataset_type=payload.dataset_type.value if payload.dataset_type else None,
        eval_type=payload.eval_type.value if payload.eval_type else None,
        is_builtin=False,
        user_id=current_user.id,
        judge_mode=payload.judge_mode.value if payload.judge_mode else None,
        score_min=payload.score_min,
        score_max=payload.score_max,
        correct_tokens=payload.correct_tokens,
        incorrect_tokens=payload.incorrect_tokens,
    )
    session.add(p)
    session.commit()
    session.refresh(p)
    return _to_read(p)


@router.patch("/{prompt_id}", response_model=PromptRead)
def update_prompt(prompt_id: int, payload: PromptUpdate, session: SessionDep, current_user: CurrentUserDep):
    p = session.get(Prompt, prompt_id)
    if not p:
        raise HTTPException(404, "Prompt not found")
    if p.is_builtin:
        raise HTTPException(403, "Built-in prompts cannot be edited")
    if p.user_id != current_user.id:
        raise HTTPException(403, "Not your prompt")

    data = payload.model_dump(exclude_unset=True)
    if "dataset_type" in data and data["dataset_type"] is not None:
        data["dataset_type"] = data["dataset_type"].value
    if "eval_type" in data and data["eval_type"] is not None:
        data["eval_type"] = data["eval_type"].value
    if "judge_mode" in data and data["judge_mode"] is not None:
        data["judge_mode"] = data["judge_mode"].value

    for k, v in data.items():
        setattr(p, k, v)

    session.add(p)
    session.commit()
    session.refresh(p)
    return _to_read(p)


@router.delete("/{prompt_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_prompt(prompt_id: int, session: SessionDep, current_user: CurrentUserDep):
    p = session.get(Prompt, prompt_id)
    if not p or p.user_id != current_user.id:
        raise HTTPException(404, "Prompt not found")
    if p.is_builtin:
        raise HTTPException(403, "Built-in prompts cannot be deleted")
    session.delete(p)
    session.commit()
