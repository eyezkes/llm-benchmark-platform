from contextlib import asynccontextmanager
import logging
import logging.handlers
import time
from pathlib import Path

from fastapi import FastAPI, HTTPException, Request
from fastapi.exception_handlers import http_exception_handler
from fastapi.middleware.cors import CORSMiddleware

from db import create_db_and_tables
from routers import auth, model, judge_model, dataset, experiment, user_api_key, prompt

# ── Logging setup ──────────────────────────────────────────────────────────────
_LOG_DIR = Path(__file__).parent.parent / "logs"
_LOG_DIR.mkdir(exist_ok=True)

_fmt = logging.Formatter(
    fmt="%(asctime)s [%(levelname)-8s] %(name)s:%(lineno)d — %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
)

# File handler: DEBUG and above, rotates at 5 MB, keeps 5 backups
_file_handler = logging.handlers.RotatingFileHandler(
    _LOG_DIR / "app.log",
    maxBytes=5 * 1024 * 1024,
    backupCount=5,
    encoding="utf-8",
)
_file_handler.setLevel(logging.DEBUG)
_file_handler.setFormatter(_fmt)

# Console handler: INFO and above
_console_handler = logging.StreamHandler()
_console_handler.setLevel(logging.INFO)
_console_handler.setFormatter(_fmt)

logging.basicConfig(level=logging.DEBUG, handlers=[_file_handler, _console_handler])

# Silence noisy third-party loggers
for _noisy in ("uvicorn.access", "httpx", "multipart", "python_multipart", "python_multipart.multipart"):
    logging.getLogger(_noisy).setLevel(logging.WARNING)

logger = logging.getLogger(__name__)

SLOW_REQUEST_MS = 3000   # warn if a request takes longer than this
_SKIP_LOG_PATHS = {"/docs", "/redoc", "/openapi.json"}
# ──────────────────────────────────────────────────────────────────────────────


@asynccontextmanager
async def lifespan(app: FastAPI):
    logger.info("Server starting up")
    create_db_and_tables()
    yield
    logger.info("Server shutting down")


app = FastAPI(title="LLM Benchmarking Platform", lifespan=lifespan, redirect_slashes=False)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.exception_handler(HTTPException)
async def _log_http_exception(request: Request, exc: HTTPException):
    # Stash the detail so the middleware can include it in one combined log line
    request.state.error_detail = exc.detail
    return await http_exception_handler(request, exc)


@app.middleware("http")
async def log_requests(request: Request, call_next):
    if request.url.path in _SKIP_LOG_PATHS:
        return await call_next(request)

    start = time.perf_counter()
    try:
        response = await call_next(request)
    except Exception:
        logger.exception("Unhandled exception on %s %s", request.method, request.url.path)
        raise

    elapsed = (time.perf_counter() - start) * 1000
    detail = getattr(request.state, "error_detail", None)
    detail_str = f" — {detail}" if detail else ""

    if elapsed >= SLOW_REQUEST_MS:
        logger.warning(
            "SLOW %s %s — %d%s (%.0f ms)",
            request.method, request.url.path, response.status_code, detail_str, elapsed,
        )
    elif response.status_code >= 400:
        logger.warning(
            "%s %s — %d%s (%.0f ms)",
            request.method, request.url.path, response.status_code, detail_str, elapsed,
        )
    else:
        logger.info(
            "%s %s — %d (%.0f ms)",
            request.method, request.url.path, response.status_code, elapsed,
        )

    return response


app.include_router(auth.router)
app.include_router(model.router)
app.include_router(judge_model.router)
app.include_router(dataset.router)
app.include_router(experiment.router)
app.include_router(user_api_key.router)
app.include_router(prompt.router)
