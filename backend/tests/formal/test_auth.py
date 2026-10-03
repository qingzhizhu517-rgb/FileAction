"""合成输入；真实集成测试另由隔离 PostgreSQL/Redis 配置启用。"""
import pytest
from fastapi.testclient import TestClient

from fileaction.auth.security import password_hasher, validate_password, normalize_username, csrf_for_session
from fileaction.api.application import create_app
from fileaction.core.config import Settings


def test_username_and_password_boundaries():
    assert normalize_username("Alice_1") == "alice_1"
    for value in ("a", "a" * 33, "a b", "中文"):
        with pytest.raises(ValueError):
            normalize_username(value)
    for value in ("short", "x" * 129, "界" * 342):
        with pytest.raises(ValueError):
            validate_password(value)
    assert validate_password("synthetic-long-password") == "synthetic-long-password"


def test_argon2id_parameters_and_csrf_binding():
    hasher = password_hasher()
    encoded = hasher.hash("synthetic-long-password")
    assert "$argon2id$v=19$m=65536,t=3,p=1$" in encoded
    assert hasher.verify(encoded, "synthetic-long-password")
    assert csrf_for_session("synthetic-secret", "token-one") != csrf_for_session("synthetic-secret", "token-two")


@pytest.mark.parametrize("host", ["127.0.0.1?next=evil", "127.0.0.1#fragment", "127.0.0.1/path"])
def test_malformed_host_is_rejected(host):
    with TestClient(create_app(Settings()), base_url="http://127.0.0.1") as client:
        response = client.get("/api/v1/health/live", headers={"Host": host})
    assert response.status_code == 400
