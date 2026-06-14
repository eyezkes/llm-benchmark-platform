import sys
import os
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "app"))

from sqlmodel import SQLModel
from db import engine
from db_models import dataset, model, experiment, user  


def reset_database():
    from sqlalchemy import text
    with engine.connect() as conn:
        conn.execute(text("DROP SCHEMA public CASCADE"))
        conn.execute(text("CREATE SCHEMA public"))
        conn.commit()
    SQLModel.metadata.create_all(engine)
    print("DB is now empty(:")


if __name__ == "__main__":
    reset_database()
