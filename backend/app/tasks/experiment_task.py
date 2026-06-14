import logging
from tasks.celery_app import celery_app
from sqlmodel import Session
from db import engine
from db_models import dataset, model, experiment, user  # en üste ekle

logger = logging.getLogger(__name__)


@celery_app.task(bind=True, name="run_experiment_task")
def run_experiment_task(self, experiment_id: int):
    logger.info("Celery task started for experiment %d", experiment_id)

    with Session(engine) as session:
        from services.experiment_service import ExperimentService
        service = ExperimentService(session)

        try:
            service.run_experiment(experiment_id)
            logger.info("Celery task completed for experiment %d", experiment_id)
            return {"status": "completed", "experiment_id": experiment_id}
        except Exception as e:
            logger.exception("Celery task failed for experiment %d: %s", experiment_id, e)
            # Safety net: if service layer didn't catch it, mark experiment failed in DB
            try:
                from db_models.experiment import Experiment, StatusType
                from datetime import datetime, timezone
                exp = session.get(Experiment, experiment_id)
                if exp and exp.status == StatusType.RUNNING:
                    exp.status = StatusType.FAILED
                    exp.updated_at = datetime.now(timezone.utc)
                    session.add(exp)
                    session.commit()
            except Exception:
                pass
            return {"status": "failed", "experiment_id": experiment_id, "error": str(e)}