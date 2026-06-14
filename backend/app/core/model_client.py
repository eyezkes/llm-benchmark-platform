"""
Unified LLM client.

Routes through OpenRouter by default (supports OpenAI, Anthropic, Google, Meta, etc.)
If base_url is provided, calls that endpoint directly (for Ollama/custom models).
"""
from __future__ import annotations

import time
import logging
from dataclasses import dataclass
from enum import Enum

from openai import OpenAI
from core.encryption import decrypt_api_key

logger = logging.getLogger(__name__)

OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1"

@dataclass
class LLMResponse:
    content: str
    ttft_ms: float | None = None
    e2e_ms: float = 0.0
    prompt_tokens: int | None = None
    completion_tokens: int | None = None

class Vendor(str, Enum):
    OPENAI = "openai"
    GEMINI = "gemini"
    CLAUDE = "claude"


VENDOR_PARAM_KEYS = {
    Vendor.OPENAI: {
        "temperature", "top_p",  "max_completion_tokens",
        "stop", "seed", "presence_penalty",
        "frequency_penalty", "response_format", "reasoning_effort",
    },
    Vendor.GEMINI: {
        "temperature", "top_p", "top_k", "max_output_tokens",
        "stop_sequences", "seed",
        "presence_penalty", "frequency_penalty",
        "response_mime_type", "thinking_config",
    },
    Vendor.CLAUDE: {
        "temperature", "top_p", "top_k", "max_tokens",
        "stop_sequences", "thinking",
    },
}


class ModelClient:
    """Thin wrapper around OpenAI-compatible chat completions."""

    def __init__(
        self,
        model_name: str,
        api_key_encrypted: str | None = None,
        base_url: str | None = None,
        system_prompt: str | None = None,
        params: dict | None = None,
    ) -> None:
        self.model_name = model_name
        self.system_prompt = system_prompt
        self.params = params or {}

        if api_key_encrypted:
            api_key = decrypt_api_key(api_key_encrypted)
        elif base_url:
            api_key = "no-key"
        else:
            raise ValueError("API key is required when base_url is not provided")

        self.client = OpenAI(
            api_key=api_key,
            base_url=base_url or OPENROUTER_BASE_URL,
        )

    def generate(self, user_message: str, timeout: float | None = 120) -> LLMResponse:
        messages = []
        if self.system_prompt:
            messages.append({"role": "system", "content": self.system_prompt})
        messages.append({"role": "user", "content": user_message})

        start = time.perf_counter()
        ttft: float | None = None

        _explicit = frozenset({"stream", "stream_options", "model", "messages", "timeout"})
        params = {k: v for k, v in self.params.items() if k not in _explicit}

        # The OpenAI SDK rejects `thinking` as a direct kwarg — send via extra_body instead.
        thinking_raw = params.pop("thinking", None)
        extra_body: dict = {}
        if thinking_raw is True:
            extra_body["thinking"] = {"type": "enabled", "budget_tokens": 16000}
        elif isinstance(thinking_raw, dict) and thinking_raw:
            extra_body["thinking"] = thinking_raw
        # False / None / empty dict → omit (thinking off by default)

        stream = self.client.chat.completions.create(
            model=self.model_name,
            messages=messages,
            stream=True,
            stream_options={"include_usage": True},
            timeout=timeout,
            extra_body=extra_body or None,
            **params,
        )

        chunks: list[str] = []
        reasoning_chunks: list[str] = []
        prompt_tokens: int | None = None
        completion_tokens: int | None = None
        for chunk in stream:
            if chunk.usage:
                prompt_tokens = chunk.usage.prompt_tokens
                completion_tokens = chunk.usage.completion_tokens
            if ttft is None:
                ttft = (time.perf_counter() - start) * 1000
            delta = chunk.choices[0].delta if chunk.choices else None
            if delta:
                if delta.content:
                    chunks.append(delta.content)
                else:
                    # OpenRouter thinking models emit reasoning in delta.reasoning
                    # rather than delta.content. Capture it as a fallback.
                    reasoning = getattr(delta, "reasoning", None) or (
                        (delta.model_extra or {}).get("reasoning") if hasattr(delta, "model_extra") else None
                    )
                    if reasoning:
                        reasoning_chunks.append(reasoning)

        e2e = (time.perf_counter() - start) * 1000
        content = "".join(chunks)
        if not content and reasoning_chunks:
            logger.warning(
                "LLM %s: text content empty, falling back to reasoning content "
                "(prompt_tokens=%s, completion_tokens=%s). "
                "Disable thinking in this model's params to get direct text output.",
                self.model_name, prompt_tokens, completion_tokens,
            )
            content = "".join(reasoning_chunks)
        elif not content:
            logger.warning(
                "LLM %s returned empty content (prompt_tokens=%s, completion_tokens=%s). "
                "If this model has thinking/reasoning enabled in its params, disable it for judge use.",
                self.model_name, prompt_tokens, completion_tokens,
            )

        logger.debug(
            "LLM %s: %d chars, ttft=%.0fms, e2e=%.0fms",
            self.model_name, len(content), ttft or 0, e2e,
        )

        return LLMResponse(content=content, ttft_ms=ttft, e2e_ms=e2e,
                           prompt_tokens=prompt_tokens, completion_tokens=completion_tokens)

    def validate(self) -> dict:
        """Send a tiny request to verify API key and model name work."""
        try:
            response = self.client.chat.completions.create(
                model=self.model_name,
                messages=[{"role": "user", "content": "Hi"}],
                max_completion_tokens=20,
            )
            return {"valid": True}
        except Exception as e:
            error_msg = str(e)
            if "401" in error_msg:
                return {"valid": False, "error": "Invalid API key"}
            if "404" in error_msg:
                return {"valid": False, "error": f"Model '{self.model_name}' not found"}
            if "402" in error_msg:
                return {"valid": False, "error": "Insufficient credits"}
            return {"valid": False, "error": error_msg}

