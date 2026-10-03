import os

import pytest

from fileaction.core.config import ConfigurationError, Settings


def test_environment_file_uses_allowlist_and_preserves_literal_secrets(tmp_path, monkeypatch):
    monkeypatch.setattr(os, "environ", {})
    env_file = tmp_path / "synthetic.env"
    env_file.write_text(
        'FILEACTION_DATABASE_URL=postgresql+psycopg://app:synthetic@localhost/fileaction\n'
        'FILEACTION_APP_SECRET=synthetic-${HOME}#literal\n'
        'UNRELATED_SECRET=must-not-load\n',
        encoding="utf-8",
    )

    settings = Settings.from_environment(env_file)

    assert settings.database_url == "postgresql+psycopg://app:synthetic@localhost/fileaction"
    assert settings.app_secret == "synthetic-${HOME}#literal"
    assert "UNRELATED_SECRET" not in os.environ


def test_explicit_empty_process_value_wins_over_env_file(tmp_path, monkeypatch):
    monkeypatch.setattr(os, "environ", {"FILEACTION_APP_SECRET": ""})
    env_file = tmp_path / "synthetic.env"
    env_file.write_text("FILEACTION_APP_SECRET=file-value\n", encoding="utf-8")

    settings = Settings.from_environment(env_file)

    assert settings.app_secret == ""
    with pytest.raises(ConfigurationError, match="FILEACTION_APP_SECRET"):
        settings.require_core()


def test_missing_database_does_not_fall_back_to_sqlite_or_memory(monkeypatch):
    monkeypatch.setattr(os, "environ", {})
    settings = Settings.from_environment(None)

    assert settings.database_url is None
    with pytest.raises(ConfigurationError, match="FILEACTION_DATABASE_URL"):
        settings.require_core()


def test_non_postgres_database_is_rejected(monkeypatch):
    monkeypatch.setattr(os, "environ", {
        "FILEACTION_DATABASE_URL": "sqlite:///fallback.db",
        "FILEACTION_AUTH_DATABASE_URL": "postgresql+psycopg://fileaction_auth_login:synthetic@localhost/fileaction",
        "FILEACTION_REDIS_URL": "redis://localhost:6379/0",
        "FILEACTION_APP_SECRET": "synthetic-secret-long-enough-for-test",
    })
    with pytest.raises(ConfigurationError, match="PostgreSQL"):
        Settings.from_environment(None).require_core()


def test_production_rejects_insecure_cookie_and_test_model_mode(monkeypatch):
    monkeypatch.setattr(os, "environ", {
        "FILEACTION_ENV": "production",
        "FILEACTION_DATABASE_URL": "postgresql+psycopg://fileaction_app:synthetic@localhost/fileaction",
        "FILEACTION_AUTH_DATABASE_URL": "postgresql+psycopg://fileaction_auth_login:synthetic@localhost/fileaction",
        "FILEACTION_REDIS_URL": "redis://localhost:6379/0",
        "FILEACTION_APP_SECRET": "synthetic-secret-long-enough-for-test",
        "FILEACTION_COOKIE_SECURE": "false",
    })
    with pytest.raises(ConfigurationError, match="COOKIE_SECURE"):
        Settings.from_environment().require_core()
    os.environ["FILEACTION_COOKIE_SECURE"] = "true"
    os.environ["FILEACTION_TEST_MODEL_MODE"] = "true"
    with pytest.raises(ConfigurationError, match="TEST_MODEL_MODE"):
        Settings.from_environment().require_core()


def test_invalid_dimension_and_boolean_are_rejected(monkeypatch):
    monkeypatch.setattr(os, "environ", {"FILEACTION_EMBEDDING_DIMENSIONS": "zero"})
    with pytest.raises(ConfigurationError, match="EMBEDDING_DIMENSIONS"):
        Settings.from_environment()
    monkeypatch.setattr(os, "environ", {"FILEACTION_COOKIE_SECURE": "maybe"})
    with pytest.raises(ConfigurationError, match="COOKIE_SECURE"):
        Settings.from_environment()
