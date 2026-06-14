from celery import Celery
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

celery_app = Celery(
    "benchmark_worker",
    broker="redis://localhost:6379/0",
    backend="redis://localhost:6379/1",
    include=["tasks.experiment_task"],
)

celery_app.conf.update(
    task_serializer="json",
    result_serializer="json",
    accept_content=["json"],
    task_track_started=True,
    task_acks_late=True,
    worker_prefetch_multiplier=1,
)