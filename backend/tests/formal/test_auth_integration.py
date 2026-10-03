"""仅使用显式的隔离合成基础设施，不接触用户 .env 或真实数据。"""
import os
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient

from fileaction.api.application import create_app
from fileaction.core.config import Settings
from fileaction.auth.security import sha256


@pytest.fixture
def client():
    required = ("FILEACTION_TEST_DATABASE_URL", "FILEACTION_TEST_AUTH_DATABASE_URL", "FILEACTION_TEST_REDIS_URL")
    if not all(os.environ.get(name) for name in required):
        pytest.skip("未提供隔离合成 PostgreSQL 和 Redis")
    settings = Settings(
        environment="test", database_url=os.environ["FILEACTION_TEST_DATABASE_URL"],
        auth_database_url=os.environ["FILEACTION_TEST_AUTH_DATABASE_URL"],
        redis_url=os.environ["FILEACTION_TEST_REDIS_URL"],
        app_secret="synthetic-auth-app-secret-long-enough", registration_enabled=True,
    )
    unique = uuid4().int
    client_ip = f"198.18.{(unique >> 8) & 255}.{unique & 255}"
    with TestClient(create_app(settings), base_url="http://127.0.0.1", client=(client_ip, 50000)) as test_client:
        test_client.created_usernames = []
        test_client.synthetic_ip = client_ip
        yield test_client
        import psycopg
        admin = os.environ.get("FILEACTION_TEST_ADMIN_DATABASE_URL")
        if admin and test_client.created_usernames:
            with psycopg.connect(admin.replace("postgresql+psycopg://", "postgresql://", 1)) as connection:
                with connection.cursor() as cursor:
                    cursor.execute("SELECT id FROM users WHERE username_normalized = ANY(%s)", (test_client.created_usernames,))
                    user_ids = [row[0] for row in cursor.fetchall()]
                    cursor.execute("DELETE FROM auth_sessions WHERE user_id = ANY(%s)", (user_ids,))
                    cursor.execute("DELETE FROM users WHERE id = ANY(%s)", (user_ids,))
        from redis import Redis
        redis = Redis.from_url(os.environ["FILEACTION_TEST_REDIS_URL"])
        keys = ["register-ip:" + client_ip, "login-ip:" + client_ip]
        keys += ["login-user:" + name for name in test_client.created_usernames]
        redis.delete(*["auth-rate:" + sha256(key) for key in keys])
        redis.close()


def csrf(client):
    response = client.get("/api/v1/auth/csrf")
    assert response.status_code == 200, response.text
    return {"X-CSRF-Token": response.json()["data"]["csrf_token"]}


def test_registration_login_csrf_logout_and_password_revocation(client):
    username = "t" + uuid4().hex[:20]
    client.created_usernames.append(username)
    password = "synthetic-password-one"
    payload = {"username": username, "password": password, "display_name": "合成用户"}
    no_csrf = client.post("/api/v1/auth/register", json=payload)
    assert no_csrf.status_code == 403
    registered = client.post("/api/v1/auth/register", headers=csrf(client), json=payload)
    assert registered.status_code == 201, registered.text
    assert "password" not in registered.text
    assert client.get("/api/v1/auth/me").status_code == 401
    duplicate = client.post("/api/v1/auth/register", headers=csrf(client), json=payload)
    assert duplicate.status_code == 409
    bad = client.post("/api/v1/auth/login", headers=csrf(client), json={"username": username, "password": "synthetic-wrong-password"})
    assert bad.status_code == 401
    login = client.post("/api/v1/auth/login", headers=csrf(client), json={"username": username, "password": password})
    assert login.status_code == 200, login.text
    assert login.cookies["fileaction_session"]
    assert "httponly" in login.headers["set-cookie"].lower()
    assert "samesite=lax" in login.headers["set-cookie"].lower()
    assert client.get("/api/v1/auth/me").json()["data"]["username"] == username
    profile = client.patch("/api/v1/auth/profile", headers=csrf(client), json={"display_name": "合成更新", "expected_revision": 1})
    assert profile.status_code == 200, profile.text
    stale = client.patch("/api/v1/auth/profile", headers=csrf(client), json={"display_name": "错误覆盖", "expected_revision": 1})
    assert stale.status_code == 409
    changed = client.post("/api/v1/auth/password", headers=csrf(client), json={"current_password": password, "new_password": "synthetic-password-two"})
    assert changed.status_code == 204, changed.text
    assert client.get("/api/v1/auth/me").status_code == 401
    assert client.post("/api/v1/auth/login", headers=csrf(client), json={"username": username, "password": password}).status_code == 401
    assert client.post("/api/v1/auth/login", headers=csrf(client), json={"username": username, "password": "synthetic-password-two"}).status_code == 200
    assert client.post("/api/v1/auth/logout", headers=csrf(client)).status_code == 204
    assert client.get("/api/v1/auth/me").status_code == 401


def test_expired_session_and_public_config_do_not_leak_secrets(client):
    username = "t" + uuid4().hex[:20]
    client.created_usernames.append(username)
    password = "synthetic-password-one"
    payload = {"username": username, "password": password, "display_name": "合成用户"}
    assert client.post("/api/v1/auth/register", headers=csrf(client), json=payload).status_code == 201
    assert client.post("/api/v1/auth/login", headers=csrf(client), json={"username": username, "password": password}).status_code == 200
    config = client.get("/api/v1/config")
    assert config.status_code == 200
    assert config.json()["data"]["storage_notice_version"] == "1"
    assert "secret" not in config.text.lower()
    import psycopg
    admin = os.environ["FILEACTION_TEST_ADMIN_DATABASE_URL"].replace("postgresql+psycopg://", "postgresql://", 1)
    with psycopg.connect(admin) as connection:
        with connection.cursor() as cursor:
            cursor.execute("UPDATE auth_sessions SET last_seen_at = now() - interval '25 hours' WHERE user_id = (SELECT id FROM users WHERE username_normalized = %s)", (username,))
    assert client.get("/api/v1/auth/me").status_code == 401


def test_origin_and_nonce_replay_are_rejected(client):
    payload = {"username": "t" + uuid4().hex[:20], "password": "synthetic-password-one", "display_name": "合成用户"}
    client.created_usernames.append(payload["username"])
    header = csrf(client)
    rejected = client.post("/api/v1/auth/register", headers={**header, "Origin": "https://evil.example"}, json=payload)
    assert rejected.status_code == 403
    accepted = client.post("/api/v1/auth/register", headers=header, json=payload)
    assert accepted.status_code == 201, accepted.text
    replay = client.post("/api/v1/auth/register", headers=header, json={**payload, "username": "u" + uuid4().hex[:20]})
    assert replay.status_code == 403


def test_logout_reports_temporary_store_failure_and_revokes_session(client, monkeypatch):
    from fileaction.storage_adapters.temporary import TemporaryError, TemporaryStore

    username = "t" + uuid4().hex[:20]
    client.created_usernames.append(username)
    password = "synthetic-password-one"
    assert client.post("/api/v1/auth/register", headers=csrf(client), json={"username": username, "password": password, "display_name": "合成用户"}).status_code == 201
    assert client.post("/api/v1/auth/login", headers=csrf(client), json={"username": username, "password": password}).status_code == 200

    async def unavailable(self, actor):
        raise TemporaryError("DEPENDENCY_UNAVAILABLE")

    monkeypatch.setattr(TemporaryStore, "end_session", unavailable)
    response = client.post("/api/v1/auth/logout", headers=csrf(client))
    assert response.status_code == 503
    assert response.json()["error"]["code"] == "DEPENDENCY_UNAVAILABLE"
    assert client.get("/api/v1/auth/me").status_code == 401
