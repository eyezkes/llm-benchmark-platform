from __future__ import annotations

import json
import logging
import math
import re
from functools import lru_cache
from urllib.request import urlopen

logger = logging.getLogger(__name__)

OPENROUTER_MODELS_URL = "https://openrouter.ai/api/v1/models"


def estimate_token_count(text: str | None) -> int:
    """Approximate token count when provider usage is unavailable."""
    if not text:
        return 0
    return max(1, math.ceil(len(str(text)) / 4))


@lru_cache(maxsize=1)
def get_all_openrouter_pricing() -> dict[str, dict[str, float]]:
    """Fetch and cache OpenRouter per-token pricing keyed by model id."""
    pricing_map: dict[str, dict[str, float]] = {}

    try:
        logger.info("Fetching OpenRouter pricing list")
        with urlopen(OPENROUTER_MODELS_URL, timeout=15) as response:
            payload = json.loads(response.read().decode("utf-8"))

        for model in payload.get("data", []):
            model_id = model.get("id")
            pricing = model.get("pricing") or {}
            if not model_id:
                continue
            pricing_map[model_id] = {
                "input": float(pricing.get("prompt") or 0.0),
                "output": float(pricing.get("completion") or 0.0),
            }

        logger.info("Cached pricing for %d OpenRouter models", len(pricing_map))
    except Exception as exc:
        logger.warning("Failed to fetch OpenRouter pricing: %s", exc)

    return pricing_map


def openrouter_model_id(vendor: str, model_name: str) -> str:
    vendor_lower = (vendor or "").lower()
    model_name = model_name or ""

    if vendor_lower == "openrouter":
        return model_name

    prefix = vendor_lower
    if prefix in {"anthropic", "claude"}:
        prefix = "anthropic"
    elif prefix in {"google", "gemini"}:
        prefix = "google"
    elif prefix == "openai":
        prefix = "openai"

    return f"{prefix}/{model_name}"


def calculate_cost(
    vendor: str,
    model_name: str,
    prompt_tokens: int,
    completion_tokens: int,
) -> float:
    """Calculate estimated USD cost from OpenRouter's public pricing list."""
    vendor_lower = (vendor or "").lower()
    if "local" in vendor_lower or "ollama" in vendor_lower:
        return 0.0

    model_id = openrouter_model_id(vendor, model_name)
    pricing_map = get_all_openrouter_pricing()
    model_price = pricing_map.get(model_id)
    if not model_price:
        # OpenRouter uses dots for version numbers (e.g. "claude-haiku-4.5") while
        # model names in our DB use dashes (e.g. "claude-haiku-4-5"). Try normalizing
        # digit-dash-digit sequences to dots.
        normalized_id = re.sub(r"(\d)-(\d)", r"\1.\2", model_id)
        if normalized_id != model_id:
            model_price = pricing_map.get(normalized_id)
    if not model_price:
        # Last resort: prefix match for date-suffixed variants (e.g. "-20251001").
        prefix = model_id + "-"
        model_price = next(
            (v for k, v in pricing_map.items() if k.startswith(prefix)),
            None,
        )
    if not model_price:
        # Last resort: user may have typed a full OpenRouter model ID (e.g.
        # "google/gemma-3-4b") with the wrong vendor selector. Try the raw name.
        model_price = pricing_map.get(model_name)
    if not model_price:
        logger.warning("Pricing not found for model '%s'", model_id)
        return 0.0

    input_cost = prompt_tokens * model_price["input"]
    output_cost = completion_tokens * model_price["output"]
    return round(input_cost + output_cost, 6)
