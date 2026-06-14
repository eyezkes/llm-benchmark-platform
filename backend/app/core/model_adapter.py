from __future__ import annotations
import anthropic
import openai
from google import genai
import time
import logging
from typing import Any, Union

from core.model_client import LLMResponse, ModelClient, Vendor
from core.encryption import decrypt_api_key

logger = logging.getLogger(__name__)

# Maps the free-form "provider" DB field to a native Vendor SDK.
# Anything not listed routes through OpenRouter via ModelClient.
VENDOR_BY_PROVIDER: dict[str, Vendor] = {
    "openai": Vendor.OPENAI,
    "anthropic": Vendor.CLAUDE,
    "claude": Vendor.CLAUDE,
    "gemini": Vendor.GEMINI,
    "google": Vendor.GEMINI,
}


def get_model_client(model: Any) -> Union[ModelClient, "VendorModelClient"]:
    """Factory: returns the right client based on model.provider."""
    vendor = VENDOR_BY_PROVIDER.get((model.provider or "").lower())
    if vendor is None:
        return ModelClient(
            model_name=model.model_name,
            api_key_encrypted=model.api_key_encrypted,
            base_url=model.base_url,
            system_prompt=model.system_prompt,
            params=model.params or {},
        )
    return VendorModelClient(
        model_name=model.model_name,
        vendor=vendor,
        api_key_encrypted=model.api_key_encrypted,
        base_url=model.base_url,
        system_prompt=model.system_prompt,
        params=model.params or {},
    )


class VendorModelClient:
    """Native-SDK client for OpenAI, Anthropic (Claude), and Google Gemini.

    Exposes the same generate() / validate() interface as ModelClient so it
    can be used as a drop-in replacement anywhere in the codebase.
    """

    def __init__(
        self,
        model_name: str,
        vendor: Vendor,
        api_key_encrypted: str | None = None,
        base_url: str | None = None,
        system_prompt: str | None = None,
        params: dict | None = None,
    ) -> None:
        self.model_name = model_name
        self.vendor = vendor
        self.system_prompt = system_prompt
        self.params = params or {}

        if api_key_encrypted:
            self._api_key = decrypt_api_key(api_key_encrypted)
        elif base_url:
            self._api_key = "no-key"
        else:
            raise ValueError("API key is required when base_url is not provided")
        self._base_url = base_url

    # ── Public interface (matches ModelClient) ─────────────────────────

    def generate(self, user_message: str, timeout: float | None = 120) -> LLMResponse:
        if self.vendor == Vendor.OPENAI:
            return self._generate_openai(user_message, timeout)
        if self.vendor == Vendor.CLAUDE:
            return self._generate_anthropic(user_message, timeout)
        if self.vendor == Vendor.GEMINI:
            return self._generate_gemini(user_message, timeout)
        raise ValueError(f"Unsupported vendor: {self.vendor}")

    def validate(self) -> dict:
        try:
            if self.vendor == Vendor.OPENAI:
                return self._validate_openai()
            if self.vendor == Vendor.CLAUDE:
                return self._validate_anthropic()
            if self.vendor == Vendor.GEMINI:
                return self._validate_gemini()
            return {"valid": False, "error": f"Unsupported vendor: {self.vendor}"}
        except Exception as e:
            return {"valid": False, "error": str(e)}

    # ── OpenAI native ──────────────────────────────────────────────────

    def _openai_client(self):
        kwargs: dict[str, Any] = {"api_key": self._api_key, "max_retries": 0}
        if self._base_url:
            kwargs["base_url"] = self._base_url
        return openai.OpenAI(**kwargs)

    def _generate_openai(self, user_message: str, timeout: float | None) -> LLMResponse:
        client = self._openai_client()
        messages: list[dict[str, str]] = []
        if self.system_prompt:
            messages.append({"role": "system", "content": self.system_prompt})
        messages.append({"role": "user", "content": user_message})

        start = time.perf_counter()
        ttft: float | None = None
        chunks: list[str] = []

        _explicit = frozenset({"stream", "stream_options", "model", "messages", "timeout"})
        params = {k: v for k, v in self.params.items() if k not in _explicit}
        prompt_tokens: int | None = None
        completion_tokens: int | None = None
        reasoning_chunks: list[str] = []

        for attempt in range(4):
            try:
                stream = client.chat.completions.create(
                    model=self.model_name,
                    messages=messages,  # type: ignore
                    stream=True,
                    stream_options={"include_usage": True},
                    timeout=timeout,
                    **params,
                )
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
                            reasoning = getattr(delta, "reasoning", None) or (
                                (delta.model_extra or {}).get("reasoning") if hasattr(delta, "model_extra") else None
                            )
                            if reasoning:
                                reasoning_chunks.append(reasoning)
                break
            except openai.RateLimitError as e:
                from core.errors import ModelError
                if getattr(e, "code", None) == "insufficient_quota":
                    raise ModelError(f"OpenAI quota exceeded: {e}") from e
                if attempt == 3:
                    raise ModelError(f"OpenAI rate limit after retries: {e}") from e
                wait = 2 ** attempt * 5
                logger.warning("OpenAI 429, waiting %ds (attempt %d/4)", wait, attempt + 1)
                time.sleep(wait)
                chunks = []
                ttft = None
                reasoning_chunks = []

        e2e = (time.perf_counter() - start) * 1000
        content = "".join(chunks)
        if not content and reasoning_chunks:
            logger.warning(
                "OpenAI %s: text content empty, falling back to reasoning content "
                "(prompt_tokens=%s, completion_tokens=%s). "
                "Disable thinking in this model's params to get direct text output.",
                self.model_name, prompt_tokens, completion_tokens,
            )
            content = "".join(reasoning_chunks)
        elif not content:
            logger.warning(
                "OpenAI %s returned empty content (prompt_tokens=%s, completion_tokens=%s).",
                self.model_name, prompt_tokens, completion_tokens,
            )
        logger.debug("OpenAI %s: %d chars, ttft=%.0fms, e2e=%.0fms",
                     self.model_name, len(content), ttft or 0, e2e)
        return LLMResponse(content=content, ttft_ms=ttft, e2e_ms=e2e,
                           prompt_tokens=prompt_tokens, completion_tokens=completion_tokens)

    def _validate_openai(self) -> dict:
        client = self._openai_client()
        
        # 1. Kullanıcının parametrelerini al ve token sınırlarını ez
        test_params = dict(self.params)
        test_params.pop("max_tokens", None)
        test_params.pop("max_completion_tokens", None)
        
        try:
            client.chat.completions.create(
                model=self.model_name,
                messages=[{"role": "user", "content": "Hi"}],
                max_tokens=20,
                **test_params
            )
            return {"valid": True}
        except Exception as e:
            msg = str(e)
            
            # Yeni nesil (o1, gpt-5.5) modeller için fallback
            if "max_completion_tokens" in msg:
                try:
                    client.chat.completions.create(
                        model=self.model_name,
                        messages=[{"role": "user", "content": "Hi"}],
                        max_completion_tokens=20,
                        **test_params
                    )
                    return {"valid": True}
                except Exception as retry_e:
                    msg = str(retry_e)

            # OpenRouter / Hızlı kesilme hatasını başarı sayma
            if "max_tokens" in msg and "reached" in msg:
                return {"valid": True}

            if "401" in msg:
                return {"valid": False, "error": "Invalid API key"}
            if "404" in msg:
                return {"valid": False, "error": f"Model '{self.model_name}' not found"}
            if "402" in msg:
                return {"valid": False, "error": "Insufficient credits"}
            
            return {"valid": False, "error": msg}

    # ── Anthropic (Claude) ─────────────────────────────────────────────

    def _anthropic_client(self):
        kwargs: dict[str, Any] = {"api_key": self._api_key}
        if self._base_url:
            kwargs["base_url"] = self._base_url
        return anthropic.Anthropic(**kwargs)

    @staticmethod
    def _normalize_anthropic_thinking(params: dict) -> dict:
        t = params.get("thinking")
        if t is True:
            params["thinking"] = {"type": "enabled", "budget_tokens": 16000}
        elif t is False or t is None:
            params.pop("thinking", None)
        return params

    def _generate_anthropic(self, user_message: str, timeout: float | None) -> LLMResponse:
        client = self._anthropic_client()

        params = self._normalize_anthropic_thinking(dict(self.params))
        max_tokens = params.pop("max_tokens", 4096)

        stream_kwargs: dict[str, Any] = dict(
            model=self.model_name,
            max_tokens=max_tokens,
            messages=[{"role": "user", "content": user_message}],
        )
        if self.system_prompt:
            stream_kwargs["system"] = self.system_prompt
        stream_kwargs.update(params)

        start = time.perf_counter()
        ttft: float | None = None
        chunks: list[str] = []

        prompt_tokens: int | None = None
        completion_tokens: int | None = None
        for attempt in range(4):
            try:
                with client.messages.stream(**stream_kwargs) as stream:
                    for text in stream.text_stream:
                        if ttft is None:
                            ttft = (time.perf_counter() - start) * 1000
                        chunks.append(text)
                    final_msg = stream.get_final_message()
                    prompt_tokens = final_msg.usage.input_tokens
                    completion_tokens = final_msg.usage.output_tokens
                break
            except anthropic.RateLimitError as e:
                if attempt == 3:
                    from core.errors import ModelError
                    raise ModelError(f"Anthropic rate limit after retries: {e}") from e
                wait = 2 ** attempt * 5
                logger.warning("Anthropic 429, waiting %ds (attempt %d/4)", wait, attempt + 1)
                time.sleep(wait)
                chunks = []
                ttft = None

        e2e = (time.perf_counter() - start) * 1000
        content = "".join(chunks)
        logger.debug("Anthropic %s: %d chars, ttft=%.0fms, e2e=%.0fms",
                     self.model_name, len(content), ttft or 0, e2e)
        return LLMResponse(content=content, ttft_ms=ttft, e2e_ms=e2e,
                           prompt_tokens=prompt_tokens, completion_tokens=completion_tokens)

    def _validate_anthropic(self) -> dict:
        client = self._anthropic_client()

        test_params = self._normalize_anthropic_thinking(dict(self.params))
        test_params.pop("max_tokens", None)

        try:
            client.messages.create(
                model=self.model_name,
                max_tokens=20,
                messages=[{"role": "user", "content": "Hi"}],
                **test_params
            )
            return {"valid": True}
        except anthropic.AuthenticationError:
            return {"valid": False, "error": "Invalid API key"}
        except anthropic.NotFoundError:
            return {"valid": False, "error": f"Model '{self.model_name}' not found"}
        except Exception as e:
            return {"valid": False, "error": str(e)}

    # ── Google Gemini ──────────────────────────────────────────────────

    def _gemini_client(self):
        if self._base_url:
            return genai.Client(
                api_key=self._api_key,
                http_options={"base_url": self._base_url},
            )
        return genai.Client(api_key=self._api_key)

    def _gemini_config(self, params: dict):
        from google.genai import types
        kwargs: dict[str, Any] = {}
        if self.system_prompt:
            kwargs["system_instruction"] = self.system_prompt
        kwargs.update(params)
        tc = kwargs.get("thinking_config")
        if tc is True:
            kwargs["thinking_config"] = {"thinking_mode": "enabled"}
        elif tc is False or tc is None:
            kwargs.pop("thinking_config", None)
        return types.GenerateContentConfig(**kwargs) if kwargs else None

    def _generate_gemini(self, user_message: str, timeout: float | None) -> LLMResponse:
        client = self._gemini_client()
        config = self._gemini_config(self.params)

        start = time.perf_counter()
        ttft: float | None = None
        chunks: list[str] = []

        last_chunk = None
        for chunk in client.models.generate_content_stream(
            model=self.model_name,
            contents=user_message,
            config=config,
        ):
            if ttft is None:
                ttft = (time.perf_counter() - start) * 1000
            if chunk.text:
                chunks.append(chunk.text)
            last_chunk = chunk

        e2e = (time.perf_counter() - start) * 1000
        content = "".join(chunks)

        prompt_tokens: int | None = None
        completion_tokens: int | None = None
        if last_chunk and last_chunk.usage_metadata:
            prompt_tokens = last_chunk.usage_metadata.prompt_token_count
            completion_tokens = last_chunk.usage_metadata.candidates_token_count

        logger.debug("Gemini %s: %d chars, ttft=%.0fms, e2e=%.0fms",
                     self.model_name, len(content), ttft or 0, e2e)
        return LLMResponse(content=content, ttft_ms=ttft, e2e_ms=e2e,
                           prompt_tokens=prompt_tokens, completion_tokens=completion_tokens)

    def _validate_gemini(self) -> dict:
        client = self._gemini_client()
        
        test_params = dict(self.params)
        test_params["max_output_tokens"] = 1  # 1 token ile test et
        
        try:
            config = self._gemini_config(test_params)
            
            client.models.generate_content(
                model=self.model_name,
                contents="Hi",
                config=config
            )
            return {"valid": True}
        except Exception as e:
            msg = str(e)
            msg_lower = msg.lower()
            if "api_key" in msg_lower or "invalid" in msg_lower or "401" in msg or "403" in msg:
                return {"valid": False, "error": "Invalid API key"}
            if "not found" in msg_lower or "404" in msg or "does not exist" in msg_lower:
                return {"valid": False, "error": f"Model '{self.model_name}' not found"}
            if "503" in msg or "unavailable" in msg_lower or "429" in msg or "quota" in msg_lower:
                return {"valid": True}
            return {"valid": False, "error": msg}