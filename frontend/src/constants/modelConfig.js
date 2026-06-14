export const VENDOR_LABELS = {
  openai: "OpenAI",
  anthropic: "Anthropic",
  google: "Google",
  openrouter: "OpenRouter",
  local: "Local",
};

export const VENDOR_MODELS = {
  openai: [
    "gpt-5.5",
    "gpt-5.5-pro",
    "gpt-5.4",
    "gpt-5.4-pro",
    "gpt-5.4-mini",
    "gpt-5.4-nano",
    "gpt-5",
    "gpt-5-mini",
    "gpt-5-nano",
    "gpt-4.1",
  ],
  anthropic: ["claude-opus-4-8", "claude-sonnet-4-6", "claude-haiku-4-5"],
  google: [
    "gemini-3.5-flash",
    "gemini-3.1-pro-preview",
    "gemini-3.1-flash-lite",
    "gemini-2.5-pro",
    "gemini-2.5-flash",
    "gemini-2.5-flash-lite",
  ],
  openrouter: [
    "openai/gpt-5.5",
    "openai/gpt-5.5-pro",
    "openai/gpt-5.4",
    "openai/gpt-5.4-pro",
    "openai/gpt-5.4-mini",
    "openai/gpt-5.4-nano",
    "openai/gpt-5",
    "openai/gpt-5-mini",
    "openai/gpt-5-nano",
    "openai/gpt-4.1",
    "anthropic/claude-opus-4.7",
    "anthropic/claude-sonnet-4.6",
    "anthropic/claude-haiku-4.5",
    "google/gemini-3.5-flash",
    "google/gemini-3.1-pro-preview",
    "google/gemini-3.1-flash-lite",
    "google/gemini-2.5-pro",
    "google/gemini-2.5-flash",
    "google/gemini-2.5-flash-lite",
  ],
};

// type: "number" | "integer" | "boolean" | "select" | "text"
// min/max apply to number and integer
// step applies to number (defaults to 0.1); integer step is always 1
// default is the pre-filled value; if absent the field starts empty
// required flags validation in the parent form
// helperText is shown below text/number fields
export const VENDOR_PARAMS = {
  openai: [
    {
      key: "temperature",
      label: "Temperature",
      type: "number",
      min: 0,
      max: 2,
      step: 0.1,
    },
    {
      key: "top_p",
      label: "Top P",
      type: "number",
      min: 0,
      max: 1,
      step: 0.05,
    },
    { key: "max_tokens", label: "Max Tokens", type: "integer" },
    {
      key: "max_completion_tokens",
      label: "Max Completion Tokens",
      type: "integer",
    },
    {
      key: "stop",
      label: "Stop Sequences",
      type: "text",
      helperText: "Comma-separated",
    },
    { key: "seed", label: "Seed", type: "integer" },
    {
      key: "presence_penalty",
      label: "Presence Penalty",
      type: "number",
      min: -2,
      max: 2,
      step: 0.1,
    },
    {
      key: "frequency_penalty",
      label: "Frequency Penalty",
      type: "number",
      min: -2,
      max: 2,
      step: 0.1,
    },
    {
      key: "reasoning_effort",
      label: "Reasoning Effort",
      type: "select",
      options: ["low", "medium", "high"],
    },
  ],
  anthropic: [
    { key: "max_tokens", label: "Max Tokens", type: "integer", required: true },
    {
      key: "temperature",
      label: "Temperature",
      type: "number",
      min: 0,
      max: 1,
      step: 0.1,
    },
    {
      key: "top_p",
      label: "Top P",
      type: "number",
      min: 0,
      max: 1,
      step: 0.05,
    },
    { key: "top_k", label: "Top K", type: "integer", min: 0 },
    {
      key: "stop_sequences",
      label: "Stop Sequences",
      type: "text",
      helperText: "Comma-separated",
    },
    {
      key: "thinking",
      label: "Thinking (Extended)",
      type: "boolean",
      default: false,
    },
  ],
  google: [
    {
      key: "temperature",
      label: "Temperature",
      type: "number",
      min: 0,
      max: 2,
      step: 0.1,
    },
    {
      key: "top_p",
      label: "Top P",
      type: "number",
      min: 0,
      max: 1,
      step: 0.05,
    },
    { key: "top_k", label: "Top K", type: "integer", min: 0 },
    { key: "max_output_tokens", label: "Max Output Tokens", type: "integer" },
    { key: "seed", label: "Seed", type: "integer" },
    {
      key: "stop_sequences",
      label: "Stop Sequences",
      type: "text",
      helperText: "Comma-separated",
    },
    {
      key: "presence_penalty",
      label: "Presence Penalty",
      type: "number",
      min: -2,
      max: 2,
      step: 0.1,
    },
    {
      key: "frequency_penalty",
      label: "Frequency Penalty",
      type: "number",
      min: -2,
      max: 2,
      step: 0.1,
    },
    {
      key: "response_mime_type",
      label: "Response MIME Type",
      type: "select",
      options: ["text/plain", "application/json"],
    },
    {
      key: "thinking_config",
      label: "Thinking (thinking_config)",
      type: "boolean",
      default: false,
    },
  ],
  openrouter: [
    {
      key: "temperature",
      label: "Temperature",
      type: "number",
      min: 0,
      max: 2,
      step: 0.1,
    },
    {
      key: "top_p",
      label: "Top P",
      type: "number",
      min: 0,
      max: 1,
      step: 0.05,
    },
    { key: "top_k", label: "Top K", type: "integer", min: 0 },
    { key: "max_tokens", label: "Max Tokens", type: "integer" },
    {
      key: "max_completion_tokens",
      label: "Max Completion Tokens",
      type: "integer",
    },
    { key: "seed", label: "Seed", type: "integer" },
    {
      key: "presence_penalty",
      label: "Presence Penalty",
      type: "number",
      min: -2,
      max: 2,
      default: 0,
      step: 0.1,
    },
    {
      key: "frequency_penalty",
      label: "Frequency Penalty",
      type: "number",
      min: -2,
      max: 2,
      default: 0,
      step: 0.1,
    },
    {
      key: "reasoning_effort",
      label: "Reasoning Effort",
      type: "select",
      options: ["low", "medium", "high", "xhigh"],
    },
    { key: "include_reasoning", label: "Include Reasoning", type: "boolean" },
  ],
  local: [
    {
      key: "temperature",
      label: "Temperature",
      type: "number",
      min: 0,
      max: 2,
      step: 0.1,
    },
    {
      key: "top_p",
      label: "Top P",
      type: "number",
      min: 0,
      max: 1,
      step: 0.05,
    },
    { key: "max_tokens", label: "Max Tokens", type: "integer" },
    { key: "seed", label: "Seed", type: "integer" },
    {
      key: "presence_penalty",
      label: "Presence Penalty",
      type: "number",
      min: -2,
      max: 2,
      step: 0.1,
    },
    {
      key: "frequency_penalty",
      label: "Frequency Penalty",
      type: "number",
      min: -2,
      max: 2,
      step: 0.1,
    },
  ],
};

// backward compat: models saved with provider="gemini" still resolve params correctly
VENDOR_PARAMS.gemini = VENDOR_PARAMS.google;

export const initParamDefaults = (vendor) => {
  const config = VENDOR_PARAMS[vendor] ?? [];
  return Object.fromEntries(
    config
      .filter((p) => p.default !== undefined)
      .map((p) => [p.key, p.default]),
  );
};
