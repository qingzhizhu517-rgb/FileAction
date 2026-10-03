"""本地启动器的进程归属与未配置状态；不启动外部服务。"""
import importlib.util
import socket
from pathlib import Path

import pytest

spec = importlib.util.spec_from_file_location("local_preview", Path(__file__).resolve().parents[2] / "scripts/local_preview.py")
preview = importlib.util.module_from_spec(spec)
spec.loader.exec_module(preview)


@pytest.mark.parametrize("saved,current", [("", ""), ("", "other"), ("old", "")])
def test_missing_signature_never_claims_process(monkeypatch, saved, current):
    monkeypatch.setattr(preview, "process_signature", lambda pid: current)
    assert not preview.process_running({"api": {"pid": 99999, "signature": saved}}, "api")


def test_worker_requires_explicit_model_configuration(monkeypatch):
    monkeypatch.setattr(preview, "worker_running", lambda config: False)
    monkeypatch.setattr(preview, "model_environment", lambda: {})
    monkeypatch.setattr(preview, "start_process", lambda *args: pytest.fail("不能启动缺少模型的worker"))
    with pytest.raises(RuntimeError, match="需要模型配置"):
        preview.start_worker({})


def test_storage_configuration_is_optional_and_never_inherited(monkeypatch, tmp_path):
    monkeypatch.setattr(preview, "STORAGE", tmp_path / "storage.env", raising=False)
    monkeypatch.setenv("COS_SECRET_KEY", "synthetic-inherited-secret")
    assert preview.storage_environment() == {}


def test_cos_env_maps_only_storage_keys_and_restricts_permissions(monkeypatch, tmp_path):
    path = tmp_path / "storage.env"
    path.write_text("\n".join([
        "STORAGE_DRIVER=cos", "COS_REGION=ap-beijing", "COS_BUCKET=synthetic-123",
        "COS_SECRET_ID=synthetic-id", "COS_SECRET_KEY=synthetic-key",
        "COS_PREFIX=fileaction/", "FILEACTION_DATABASE_URL=must-not-override",
    ]))
    path.chmod(0o644)
    monkeypatch.setattr(preview, "STORAGE", path, raising=False)
    assert preview.storage_environment() == {
        "FILEACTION_COS_REGION": "ap-beijing", "FILEACTION_COS_BUCKET": "synthetic-123",
        "FILEACTION_COS_SECRET_ID": "synthetic-id", "FILEACTION_COS_SECRET_KEY": "synthetic-key",
        "FILEACTION_COS_PREFIX": "fileaction/", "FILEACTION_COS_SSE_MODE": "AES256",
    }
    assert path.stat().st_mode & 0o777 == 0o600


@pytest.mark.parametrize("content", ["STORAGE_DRIVER=local", "STORAGE_DRIVER=cos\nCOS_SECRET_KEY=synthetic-key"])
def test_invalid_storage_configuration_fails_without_echoing_values(monkeypatch, tmp_path, content):
    path = tmp_path / "storage.env"
    path.write_text(content)
    monkeypatch.setattr(preview, "STORAGE", path, raising=False)
    with pytest.raises(RuntimeError) as error:
        preview.storage_environment()
    assert "synthetic-key" not in str(error.value)


def test_storage_configuration_refuses_symlink(monkeypatch, tmp_path):
    target = tmp_path / "private.env"
    target.write_text("STORAGE_DRIVER=cos")
    path = tmp_path / "storage.env"
    path.symlink_to(target)
    monkeypatch.setattr(preview, "STORAGE", path, raising=False)
    with pytest.raises(RuntimeError, match="符号链接"):
        preview.storage_environment()


def test_cos_immutable_mode_is_forwarded_only_when_explicitly_configured(monkeypatch, tmp_path):
    path = tmp_path / "storage.env"
    path.write_text("STORAGE_DRIVER=cos\nCOS_REGION=ap-test\nCOS_BUCKET=synthetic-123\nCOS_SECRET_ID=synthetic-id\nCOS_SECRET_KEY=synthetic-key\nCOS_OBJECT_MODE=immutable_key\n")
    monkeypatch.setattr(preview, "STORAGE", path)
    assert preview.storage_environment()["FILEACTION_COS_OBJECT_MODE"] == "immutable_key"


def test_api_probe_accepts_recently_closed_server_port(monkeypatch):
    """真实本机临时端口 TIME_WAIT；不启动 API 或外部依赖。"""
    with socket.socket() as listener:
        listener.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        listener.bind(("127.0.0.1", 0))
        port = listener.getsockname()[1]
        listener.listen()
        with socket.create_connection(("127.0.0.1", port)) as client:
            accepted, _ = listener.accept()
            accepted.shutdown(socket.SHUT_WR)
            assert client.recv(1) == b""
            accepted.close()
    monkeypatch.setattr(preview, "api_running", lambda config: False)
    monkeypatch.setattr(preview, "model_environment", lambda: {})
    monkeypatch.setattr(preview, "storage_environment", lambda: {})
    def reached_start(*args): raise LookupError("probe passed")
    monkeypatch.setattr(preview, "start_process", reached_start)
    with pytest.raises(LookupError, match="probe passed"):
        preview.start_api({"environment": {}}, port)


def test_api_probe_still_rejects_a_listening_service(monkeypatch):
    monkeypatch.setattr(preview, "api_running", lambda config: False)
    with socket.socket() as listener:
        listener.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        listener.bind(("127.0.0.1", 0))
        listener.listen()
        with pytest.raises(RuntimeError, match="已被占用"):
            preview.start_api({}, listener.getsockname()[1])


def test_demo_credentials_require_explicit_local_enablement(monkeypatch, tmp_path):
    import json
    path = tmp_path / "default-account.json"
    monkeypatch.setattr(preview, "DEFAULT_ACCOUNT", path, raising=False)
    monkeypatch.setenv("FILEACTION_DEMO_ENABLED", "true")
    assert preview.demo_environment() == {}
    path.write_text(json.dumps({"username": "synthetic_demo", "password": "synthetic-private-password"}))
    assert preview.demo_environment() == {}
    path.write_text(json.dumps({"demo_enabled": True, "username": "synthetic_demo", "password": "synthetic-private-password"}))
    path.chmod(0o644)
    assert preview.demo_environment() == {
        "FILEACTION_DEMO_ENABLED": "true",
        "FILEACTION_DEMO_USERNAME": "synthetic_demo",
        "FILEACTION_DEMO_PASSWORD": "synthetic-private-password",
    }
    assert path.stat().st_mode & 0o777 == 0o600


def test_demo_configuration_rejects_incomplete_credentials_without_echo(monkeypatch, tmp_path):
    path = tmp_path / "default-account.json"
    path.write_text('{"demo_enabled": true, "password": "synthetic-private-password"}')
    monkeypatch.setattr(preview, "DEFAULT_ACCOUNT", path, raising=False)
    with pytest.raises(RuntimeError) as error:
        preview.demo_environment()
    assert "synthetic-private-password" not in str(error.value)


def test_demo_configuration_refuses_symlinks(monkeypatch, tmp_path):
    target = tmp_path / "account.json"
    target.write_text('{}')
    path = tmp_path / "default-account.json"
    path.symlink_to(target)
    monkeypatch.setattr(preview, "DEFAULT_ACCOUNT", path, raising=False)
    with pytest.raises(RuntimeError, match="符号链接"):
        preview.demo_environment()
