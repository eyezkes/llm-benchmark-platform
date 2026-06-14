class EvaluationError(Exception):
    """Raised when a judge cannot evaluate an answer."""

class ModelError(Exception):
    """Raised when an LLM API call fails."""
