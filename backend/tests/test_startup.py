import os
import sys
from pathlib import Path

import pytest

from fileaction import legacy as startup
from fileaction import __main__ as formal_startup
from fileaction import app as legacy_app
from fileaction import storage


def test_legacy_project_root_resolves_repository_root():
    assert startup.PROJECT_ROOT == Path(__file__).resolve().parents[2]
    assert formal_startup.PROJECT_ROOT == startup.PROJECT_ROOT
    assert legacy_app.Path(legacy_app.__file__).resolve().parents[2] == startup.PROJECT_ROOT


def test_legacy_memory_path_stays_at_project_root_across_cwd(monkeypatch, tmp_path):
    synthetic_root = tmp_path / "project"
    synthetic_root.mkdir()
    monkeypatch.setattr(storage, "PROJECT_ROOT", synthetic_root)
    monkeypatch.delenv("FILEACTION_DATA_DIR", raising=False)
    first = tmp_path / "one"
    second = tmp_path / "two"
    first.mkdir()
    second.mkdir()
    monkeypatch.chdir(first)
    created = storage.MemoryStore().create("合成背景", "synthetic")
    monkeypatch.chdir(second)
    assert storage.MemoryStore().get(created.id).text == "合成背景"
    assert (synthetic_root / "var" / "fileaction.db").exists()


def test_legacy_memory_directory_can_be_isolated(monkeypatch, tmp_path):
    monkeypatch.setenv("FILEACTION_DATA_DIR", str(tmp_path))
    assert storage.MemoryStore().path == tmp_path / "fileaction.db"


@pytest.fixture
def isolated_startup(monkeypatch, tmp_path):
    # 只使用合成配置；不读取用户 .env，也不污染后续测试进程。
    monkeypatch.setattr(os, "environ", {})
    monkeypatch.setattr(startup, "PROJECT_ROOT", tmp_path, raising=False)
    monkeypatch.setattr(sys, "argv", ["python -m fileaction"])
    captured = {}

    def capture_run(app, **kwargs):
        captured.update(kwargs)
        captured["app"] = app
        captured["environment"] = {key: value for key, value in os.environ.items() if key != "PYTEST_CURRENT_TEST"}

    monkeypatch.setattr(startup.uvicorn, "run", capture_run)
    return tmp_path, captured


def test_local_startup_disables_access_log(isolated_startup):
    """仅替换服务启动，验证不会记录带上传文件名的访问 URL。"""
    _, captured = isolated_startup
    startup.main()
    assert captured["host"] == "127.0.0.1"
    assert captured["port"] == 8766
    assert captured["access_log"] is False


def test_startup_loads_project_env_before_server_from_another_directory(isolated_startup, monkeypatch):
    root, captured = isolated_startup
    (root / ".env").write_text(
        'FILEACTION_MODEL_BASE_URL=https://synthetic.invalid/v1\n'
        'FILEACTION_MODEL_API_KEY=synthetic-placeholder\n'
        'FILEACTION_MODEL_NAME=synthetic-model\n', encoding="utf-8",
    )
    elsewhere = root / "elsewhere"
    elsewhere.mkdir()
    (elsewhere / ".env").write_text('FILEACTION_MODEL_NAME=wrong-directory\n', encoding="utf-8")
    monkeypatch.chdir(elsewhere)
    startup.main()
    assert captured["environment"] == {
        "FILEACTION_MODEL_BASE_URL": "https://synthetic.invalid/v1",
        "FILEACTION_MODEL_API_KEY": "synthetic-placeholder",
        "FILEACTION_MODEL_NAME": "synthetic-model",
    }


@pytest.mark.parametrize("existing", ["process-model", ""])
def test_startup_preserves_explicit_environment_even_when_empty(isolated_startup, existing):
    root, captured = isolated_startup
    (root / ".env").write_text(
        'FILEACTION_MODEL_NAME=file-model\nFILEACTION_MODEL_API_KEY=synthetic-placeholder\n', encoding="utf-8",
    )
    os.environ["FILEACTION_MODEL_NAME"] = existing
    startup.main()
    assert captured["environment"]["FILEACTION_MODEL_NAME"] == existing
    assert captured["environment"].get("FILEACTION_MODEL_API_KEY") == "synthetic-placeholder"


def test_startup_preserves_literal_credentials_and_only_loads_allowed_keys(isolated_startup, capsys):
    root, captured = isolated_startup
    content = (
        '# 合成配置，非真实密钥\n'
        'export FILEACTION_MODEL_API_KEY="synthetic-${HOME}#literal"\n'
        'FILEACTION_MODEL_NAME=synthetic-model # comment\n'
        'FILEACTION_MODEL_BASE_URL\n'
        'UNRELATED_SECRET=do-not-load\n'
    )
    (root / ".env").write_text(content, encoding="utf-8-sig")
    startup.main()
    assert captured["environment"] == {
        "FILEACTION_MODEL_API_KEY": "synthetic-${HOME}#literal",
        "FILEACTION_MODEL_NAME": "synthetic-model",
    }
    assert (root / ".env").read_text(encoding="utf-8-sig") == content
    output = capsys.readouterr()
    assert output.out == output.err == ""


def test_startup_without_env_file_remains_unconfigured(isolated_startup):
    _, captured = isolated_startup
    startup.main()
    assert captured["environment"] == {}


def test_startup_can_disable_env_file_for_isolated_tests(isolated_startup, monkeypatch):
    root, captured = isolated_startup
    (root / ".env").write_text('FILEACTION_MODEL_API_KEY=must-not-load\n', encoding="utf-8")
    monkeypatch.setattr(sys, "argv", ["python -m fileaction", "--no-env-file", "--port", "8778"])
    startup.main()
    assert captured["environment"] == {}
    assert captured["port"] == 8778
