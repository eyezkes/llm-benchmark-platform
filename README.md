# LLM Benchmark Platform

A full-stack platform for evaluating and comparing large language models (LLMs). Define models, datasets, and judge models to run experiments and analyze results with metrics such as BLEU, ROUGE, accuracy, and semantic similarity.

## Repository Structure

```
├── backend/    # FastAPI REST API + Celery task queue
└── frontend/   # React + Vite SPA
```

---

## Backend

### Tech Stack

- **FastAPI** + **Uvicorn** — REST API
- **SQLModel** / **SQLAlchemy 2** + **PostgreSQL** — Database
- **Celery** + **Redis** — Async task queue
- **Anthropic / OpenAI / Google GenAI** — LLM integrations
- **Sentence-Transformers, PyTorch, Scikit-learn** — Similarity metrics
- **Pydantic v2** — Schema validation
- **JWT (python-jose)** — Authentication

### Setup

```bash
cd backend
pip install -r requirements.txt
```

Create a `.env` file in `backend/`:

```env
DATABASE_URL=postgresql+psycopg2://postgres:postgres@localhost:5432/benchmarking
JWT_SECRET_KEY=your-secret-key
ENCRYPTION_KEY=your-32-byte-fernet-key
```

### Running

Run all commands from the `backend/` directory:

```bash
cd backend

# API server
uvicorn main:app --app-dir app --reload

# Celery worker (required for async experiment execution) — separate terminal
celery -A app.tasks.experiment_task worker --loglevel=info
```

API runs at `http://localhost:8000` · Swagger UI at `http://localhost:8000/docs`

### Project Structure

```
backend/
├── app/
│   ├── main.py          # Application entry point
│   ├── config.py        # Environment settings
│   ├── db.py            # Database initialization
│   ├── routers/         # API route handlers
│   ├── db_models/       # SQLModel table definitions
│   ├── schemas/         # Pydantic request/response schemas
│   ├── services/        # Business logic
│   ├── core/            # Model adapters, pricing, auth utilities
│   └── tasks/           # Celery background tasks
└── tests/
```

### API Routes

| Prefix | Description |
|---|---|
| `/auth` | Register, login, token refresh, password change |
| `/models` | LLM model management |
| `/datasets` | Dataset upload and management |
| `/judge-models` | Judge model management |
| `/experiments` | Create, run, and analyze experiments |
| `/api-keys` | User API key management |

### Tests

```bash
pytest tests/
```

---

## Frontend

### Tech Stack

- **React 18** + **Vite** — SPA framework
- **Axios** — HTTP client
- **Yarn** — Package manager

### Setup

```bash
cd frontend
yarn install
```

Create a `.env.local` file in `frontend/` to point at the backend:

```env
VITE_API_BASE_URL=http://localhost:8000
```

If this file is omitted, `http://localhost:8000` is used by default.

### Running

```bash
cd frontend

# Development server
yarn dev

# Production build
yarn build
```

Dev server runs at `http://localhost:5173`.

### Pages

| Route | Description |
|---|---|
| `/login` | Login |
| `/register` | Register |
| `/` | Dashboard — overview of recent experiments |
| `/experiments` | List all experiments |
| `/experiments/:id` | Experiment detail with metric charts |
| `/models` | Manage LLM models |
| `/datasets` | Upload and manage datasets |
| `/judges` | Manage judge models |
| `/prompts` | Prompt library |
| `/api-keys` | Manage personal API keys |
| `/change-password` | Change password |

### Project Structure

```
frontend/
├── index.html
├── vite.config.js
└── src/
    ├── main.jsx              # Entry point
    ├── App.jsx               # Router setup
    ├── api/                  # Axios client + per-resource service functions
    ├── components/           # Shared UI components (graphs, logo, etc.)
    ├── context/              # React context (auth, LLM state)
    ├── Layout/               # Dashboard shell layout
    ├── pages/                # One file per route
    └── constants/            # Color palette, model configs, static data
```
