import sys
import os
from pathlib import Path

# Make app/ importable (from db import engine, from config import get_settings, etc.)
sys.path.insert(0, str(Path(__file__).parent.parent / "app"))

# Pre-load test env vars BEFORE any test module is imported so that
# get_settings() (which is lru_cache'd) picks up the test DATABASE_URL.
_env_path = Path(__file__).parent / ".env.test"
if _env_path.exists():
    for _line in _env_path.read_text(encoding="utf-8").splitlines():
        _line = _line.strip()
        if not _line or _line.startswith("#") or "=" not in _line:
            continue
        _key, _value = _line.split("=", 1)
        _key = _key.strip()
        if _key and _key not in os.environ:
            os.environ[_key] = _value.strip().strip('"').strip("'")
