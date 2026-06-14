import pandas as pd
import logging
import httpx
from functools import lru_cache

logger = logging.getLogger(__name__)


def validate_required_columns(df: pd.DataFrame, required: list[str]) -> None:
    missing = [c for c in required if c not in df.columns]
    if missing:
        raise ValueError(f"Missing required columns: {missing}")




@lru_cache(maxsize=1)
def get_all_openrouter_pricing() -> dict:
    """
    Fetches the pricing for all models from OpenRouter in a single request
    and caches the result in memory. Subsequent calls will read from the cache
    without making additional network requests.
    """
    logger.info("Fetching the latest OpenRouter pricing list into memory...")
    pricing_map = {}

    try:
        # OpenRouter API endpoint for models and pricing
        response = httpx.get("https://openrouter.ai/api/v1/models", timeout=15.0)
        response.raise_for_status()
        models = response.json().get("data", [])

        for model in models:
            model_id = model.get("id")
            pricing = model.get("pricing", {})
            
            # OpenRouter provides prices per 1 token
            pricing_map[model_id] = {
                "input": float(pricing.get("prompt", 0.0)),
                "output": float(pricing.get("completion", 0.0)),
            }
        
        logger.info(f"Successfully cached pricing for {len(pricing_map)} models.")
    except Exception as e:
        logger.error(f"Failed to fetch OpenRouter pricing: {e}")

    return pricing_map

def calculate_cost(vendor: str, model_name: str, prompt_tokens: int, completion_tokens: int) -> float:
    """
    Calculates the total experiment cost (in USD) based on the vendor, model, 
    and token usage.
    """
    # 1. Local models (e.g., Ollama, vLLM) are always free of charge
    if "local" in vendor.lower() or "ollama" in vendor.lower():
        return 0.0

    # 2. Retrieve the cached pricing map
    pricing_map = get_all_openrouter_pricing()

    # 3. Convert Native SDK model names to OpenRouter's 'provider/model' format
    if vendor.lower() == "openrouter":
        or_model_id = model_name
    else:
        prefix = vendor.lower()
        # Map native vendors to OpenRouter prefixes
        if prefix == "claude":
            prefix = "anthropic"
        elif prefix == "gemini":
            prefix = "google"
        
        or_model_id = f"{prefix}/{model_name}"

    # 4. Look up the specific model's pricing
    model_price = pricing_map.get(or_model_id)

    # If the model is not found in OpenRouter's list, cost defaults to 0.0
    if not model_price:
        logger.warning(f"Could not calculate cost: '{or_model_id}' not found in OpenRouter pricing list.")
        return 0.0

    input_cost = prompt_tokens * model_price["input"]
    output_cost = completion_tokens * model_price["output"]
    
    total_cost = input_cost + output_cost

    return round(total_cost, 6)