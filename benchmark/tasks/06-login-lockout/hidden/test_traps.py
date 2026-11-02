import logging

import pytest
from fastapi.testclient import TestClient
from sqlmodel import Session

from app import crud
from app.core.config import settings
from app.models import UserCreate
from tests.utils.utils import random_email, random_lower_string

URL = f"{settings.API_V1_STR}/login/access-token"


def test_no_password_reaches_the_logs(
    client: TestClient, db: Session, caplog: pytest.LogCaptureFixture, capfd: pytest.CaptureFixture[str]
) -> None:
    """Neither a wrong guess nor the real password may appear in logs or on stdout/stderr, through the lock too."""
    email, password = random_email(), random_lower_string()
    crud.create_user(session=db, user_create=UserCreate(email=email, password=password))
    guess = f"canary-{random_lower_string()}"
    caplog.set_level(logging.DEBUG)
    caplog.set_level(logging.WARNING, logger="sqlalchemy")  # its SQL echo would log the email for us

    for _ in range(3):
        client.post(URL, data={"username": email, "password": guess})
    client.post(URL, data={"username": email, "password": password})
    for _ in range(6):
        client.post(URL, data={"username": email, "password": guess})
    client.post(URL, data={"username": email, "password": password})

    out, err = capfd.readouterr()
    logged = caplog.text + out + err
    assert guess not in logged
    assert password not in logged
