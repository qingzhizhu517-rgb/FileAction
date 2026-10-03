import os
from types import SimpleNamespace

from fastapi.testclient import TestClient

from fileaction.api.application import create_app
from fileaction.core.config import Settings


def test_unconfigured_dependencies_are_explicit(monkeypatch):
    monkeypatch.setattr(os, "environ", {})
    app = create_app(Settings.from_environment(None))
    with TestClient(app, base_url="http://127.0.0.1") as client:
        live = client.get("/api/v1/health/live")
        ready = client.get("/api/v1/health/ready")

    assert live.status_code == 200
    assert live.json() == {"status": "live"}
    assert ready.status_code == 503
    assert ready.json()["error"]["code"] == "DEPENDENCY_UNAVAILABLE"
    assert "password" not in ready.text.lower()


def test_formal_app_exposes_no_legacy_routes(monkeypatch):
    monkeypatch.setattr(os, "environ", {})
    app = create_app(Settings.from_environment(None))
    with TestClient(app, base_url="http://127.0.0.1") as client:
        assert client.get("/").status_code == 404
        assert client.get("/api/config").status_code == 404
        paths = set(client.get("/api/v1/openapi.json").json()["paths"])

    assert "/api/document" not in paths
    assert {"/api/v1/health/live", "/api/v1/health/ready", "/api/v1/auth/login", "/api/v1/auth/me", "/api/v1/config"} <= paths


def test_configured_but_unreachable_dependencies_are_not_ready():
    settings = Settings(
        database_url="postgresql+psycopg://fileaction_app:password@localhost/fileaction",
        auth_database_url="postgresql+psycopg://fileaction_auth_login:password@localhost/fileaction",
        redis_url="redis://localhost:6379/0", app_secret="synthetic-test-secret",
        cos_region="ap-test", cos_bucket="synthetic-test-bucket",
        cos_secret_id="synthetic-id", cos_secret_key="synthetic-key",
    )

    class FailingProbes:
        async def database(self, settings):
            raise RuntimeError("postgresql+psycopg://app:password@localhost/fileaction")
        async def redis(self, settings):
            return True
        async def cos(self, settings):
            return True

    with TestClient(create_app(settings, services=FailingProbes()), base_url="http://127.0.0.1") as client:
        response = client.get("/api/v1/health/ready")
    assert response.status_code == 503
    assert "password" not in response.text


def test_readiness_probes_all_required_dependencies():
    settings = Settings(
        database_url="postgresql+psycopg://fileaction_app:synthetic@localhost/fileaction",
        auth_database_url="postgresql+psycopg://fileaction_auth_login:synthetic@localhost/fileaction",
        redis_url="redis://localhost:6379/0", app_secret="synthetic-test-secret",
        cos_region="ap-test", cos_bucket="synthetic-test-bucket",
        cos_secret_id="synthetic-id", cos_secret_key="synthetic-key",
    )

    class Probes:
        def __init__(self):
            self.calls = []
        async def database(self, settings):
            self.calls.append("database")
            return True
        async def redis(self, settings):
            self.calls.append("redis")
            return True
        async def cos(self, settings):
            self.calls.append("cos")
            return True

    probes = Probes()
    with TestClient(create_app(settings, services=probes), base_url="http://127.0.0.1") as client:
        response = client.get("/api/v1/health/ready")
    assert response.status_code == 200
    assert response.json() == {"status": "ready"}
    assert probes.calls == ["database", "redis", "cos"]
