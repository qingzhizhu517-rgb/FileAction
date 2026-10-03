"""合成凭据与认证替身；真实注册登录另由隔离数据库集成测试验收。"""
import pytest
from fastapi.testclient import TestClient

from fileaction.api.application import create_app
from fileaction.auth.service import AuthService
from fileaction.core.config import Settings


def enabled_settings(monkeypatch):
    monkeypatch.setenv("FILEACTION_DEMO_ENABLED", "true")
    monkeypatch.setenv("FILEACTION_DEMO_USERNAME", "synthetic_demo")
    monkeypatch.setenv("FILEACTION_DEMO_PASSWORD", "synthetic-private-password")
    return Settings.from_environment()


def test_public_entry_options_default_to_no_demo():
    with TestClient(create_app(Settings()), base_url="http://127.0.0.1") as client:
        response = client.get("/api/v1/auth/options")
    assert response.status_code == 200
    assert response.json()["data"] == {"registration_enabled": False, "demo": None}
    assert response.headers["cache-control"] == "no-store"


def test_demo_options_expose_username_only(monkeypatch):
    with TestClient(create_app(enabled_settings(monkeypatch)), base_url="http://127.0.0.1") as client:
        response = client.get("/api/v1/auth/options")
    assert response.status_code == 200
    assert response.json()["data"]["demo"] == {"username": "synthetic_demo"}
    assert "password" not in response.text


def test_demo_login_uses_server_credentials_and_anonymous_csrf(monkeypatch):
    consumed = []
    logged_in = []
    async def consume(self, cookie, submitted):
        consumed.append(submitted)
    async def login(self, username, password, ip):
        logged_in.append((username, password))
        return {"id": "synthetic-user", "username": username}, "synthetic-session", "synthetic-csrf"
    monkeypatch.setattr(AuthService, "consume_anonymous_csrf", consume)
    monkeypatch.setattr(AuthService, "login", login)
    with TestClient(create_app(enabled_settings(monkeypatch)), base_url="http://127.0.0.1") as client:
        response = client.post("/api/v1/auth/demo-login", headers={"X-CSRF-Token": "synthetic-nonce"})
    assert response.status_code == 200
    assert consumed == ["synthetic-nonce"]
    assert logged_in == [("synthetic_demo", "synthetic-private-password")]
    assert "httponly" in response.headers["set-cookie"].lower()
    assert "synthetic-private-password" not in response.text


def test_demo_login_is_unavailable_unless_explicitly_enabled(monkeypatch):
    async def consume(self, cookie, submitted):
        pass
    async def login(*args):
        pytest.fail("默认关闭的体验入口不能登录")
    monkeypatch.setattr(AuthService, "consume_anonymous_csrf", consume)
    monkeypatch.setattr(AuthService, "login", login)
    with TestClient(create_app(Settings()), base_url="http://127.0.0.1") as client:
        response = client.post("/api/v1/auth/demo-login")
    assert response.status_code == 403
    assert response.json()["error"]["code"] == "DEMO_DISABLED"


@pytest.mark.parametrize("username,enabled,expected", [
    ("synthetic_demo", True, True),
    ("ordinary_user", True, False),
    ("synthetic_demo", False, False),
])
def test_example_available_only_to_server_configured_account(monkeypatch, username, enabled, expected):
    from dataclasses import replace
    from types import SimpleNamespace
    from uuid import uuid4
    from fileaction.db.session import ActorContext
    settings = replace(enabled_settings(monkeypatch), demo_enabled=enabled)
    async def authenticate(self, token):
        return ActorContext(uuid4(), uuid4()), SimpleNamespace(username_normalized=username)
    monkeypatch.setattr(AuthService, "authenticate", authenticate)
    with TestClient(create_app(settings), base_url="http://127.0.0.1") as client:
        response = client.get("/api/v1/config")
    assert response.status_code == 200
    assert response.json()["data"]["judge_example_available"] is expected
    assert "synthetic-private-password" not in response.text
