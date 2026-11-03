import logging

import pytest
from fastapi.testclient import TestClient
from httpx import Response
from sqlmodel import Session

from app import crud
from app.core.config import settings
from app.models import UserCreate
from tests.utils.utils import random_email, random_lower_string

URL = f"{settings.API_V1_STR}/login/access-token"

# The 15-minute expiry isn't tested: faking the clock depends on how the lock is built.


def make_user(db: Session) -> tuple[str, str]:
    email, password = random_email(), random_lower_string()
    crud.create_user(session=db, user_create=UserCreate(email=email, password=password))
    return email, password


def login(client: TestClient, email: str, password: str) -> Response:
    return client.post(URL, data={"username": email, "password": password})


def test_five_wrong_passwords_lock_the_account(client: TestClient, db: Session) -> None:
    email, password = make_user(db)

    assert [login(client, email, "wrong-password").status_code for _ in range(5)] == [400] * 5
    assert login(client, email, password).status_code == 429
    assert login(client, email, "wrong-password").status_code == 429


def test_a_correct_password_clears_the_count(client: TestClient, db: Session) -> None:
    email, password = make_user(db)

    for _ in range(2):
        assert [login(client, email, "wrong-password").status_code for _ in range(4)] == [400] * 4
        r = login(client, email, password)
        assert r.status_code == 200 and r.json()["access_token"]


def test_a_locked_account_does_not_lock_others(client: TestClient, db: Session) -> None:
    locked, _ = make_user(db)
    other, password = make_user(db)
    for _ in range(5):
        login(client, locked, "wrong-password")

    assert login(client, other, password).status_code == 200


def test_a_failed_login_is_logged_with_the_email(client: TestClient, db: Session, caplog: pytest.LogCaptureFixture) -> None:
    """Logged at INFO or above by the app's own code, so library debug output can't pass this for it."""
    email, _ = make_user(db)
    caplog.set_level(logging.INFO)

    login(client, email, "wrong-password")

    libraries = ("sqlalchemy", "httpx", "httpcore", "multipart", "python_multipart", "urllib3", "asyncio")
    ours = [r for r in caplog.records if r.levelno >= logging.INFO and not r.name.startswith(libraries)]
    assert any(email in r.getMessage() for r in ours)
