from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path
from urllib.parse import urlsplit

from .errors import ConfigurationError

ENV_KEYS = (
    "FILEACTION_ENV", "FILEACTION_DATABASE_URL", "FILEACTION_AUTH_DATABASE_URL", "FILEACTION_REDIS_URL",
    "FILEACTION_APP_SECRET", "FILEACTION_COS_REGION", "FILEACTION_COS_BUCKET",
    "FILEACTION_COS_PREFIX", "FILEACTION_COS_SECRET_ID", "FILEACTION_COS_SECRET_KEY",
    "FILEACTION_COS_SESSION_TOKEN", "FILEACTION_COS_SSE_MODE", "FILEACTION_COS_OBJECT_MODE",
    "FILEACTION_EMBEDDING_BASE_URL", "FILEACTION_EMBEDDING_API_KEY",
    "FILEACTION_EMBEDDING_MODEL", "FILEACTION_EMBEDDING_DIMENSIONS",
    "FILEACTION_EMBEDDING_PROFILE_VERSION", "FILEACTION_EMBEDDING_MAX_BATCH_ITEMS",
    "FILEACTION_EMBEDDING_MAX_BATCH_TOKENS", "FILEACTION_MODEL_BASE_URL",
    "FILEACTION_MODEL_API_KEY", "FILEACTION_MODEL_NAME", "FILEACTION_ALLOWED_ORIGINS",
    "FILEACTION_TRUSTED_HOSTS", "FILEACTION_REGISTRATION_ENABLED", "FILEACTION_COOKIE_SECURE",
    "FILEACTION_TEST_MODEL_MODE",
)


def _dotenv_values(path: Path) -> dict[str, str]:
    values: dict[str, str] = {}
    if not path.is_file():
        return values
    for raw in path.read_text(encoding="utf-8-sig").splitlines():
        line = raw.strip()
        if not line or line.startswith("#"):
            continue
        if line.startswith("export "):
            line = line[7:].lstrip()
        if "=" not in line:
            continue
        key, value = line.split("=", 1)
        key = key.strip()
        if key not in ENV_KEYS:
            continue
        value = value.strip()
        if len(value) >= 2 and value[0] == value[-1] and value[0] in {'"', "'"}:
            value = value[1:-1]
        elif " #" in value:
            value = value.split(" #", 1)[0].rstrip()
        values[key] = value
    return values


def _int(name: str, values: dict[str, str], default: int | None = None) -> int | None:
    raw = values.get(name)
    if raw in (None, ""):
        return default
    try:
        return int(raw)
    except ValueError as exc:
        raise ConfigurationError(f"{name} 必须是整数") from exc


def _bool(name: str, values: dict[str, str], default: bool = False) -> bool:
    raw = values.get(name)
    if raw is None:
        return default
    if raw.lower() in {"true", "1", "yes"}:
        return True
    if raw.lower() in {"false", "0", "no"}:
        return False
    raise ConfigurationError(f"{name} 必须是布尔值")


@dataclass(frozen=True)
class Settings:
    environment: str = "development"
    database_url: str | None = None
    auth_database_url: str | None = None
    redis_url: str | None = None
    app_secret: str | None = None
    cos_region: str | None = None
    cos_bucket: str | None = None
    cos_prefix: str = "fileaction/"
    cos_secret_id: str | None = None
    cos_secret_key: str | None = None
    cos_session_token: str | None = None
    cos_sse_mode: str | None = None
    cos_object_mode: str = "versioned"
    embedding_base_url: str | None = None
    embedding_api_key: str | None = None
    embedding_model: str | None = None
    embedding_dimensions: int | None = None
    embedding_profile_version: int | None = None
    embedding_max_batch_items: int = 10
    embedding_max_batch_tokens: int | None = None
    model_base_url: str | None = None
    model_api_key: str | None = None
    model_name: str | None = None
    allowed_origins: tuple[str, ...] = ()
    trusted_hosts: tuple[str, ...] = ("127.0.0.1", "localhost")
    registration_enabled: bool = False
    cookie_secure: bool = False
    test_model_mode: bool = False

    def __post_init__(self):
        if self.cos_object_mode not in {"versioned", "immutable_key"}:
            raise ConfigurationError("FILEACTION_COS_OBJECT_MODE 必须是 versioned 或 immutable_key")

    @classmethod
    def from_environment(cls, env_file: Path | None = None) -> "Settings":
        file_values = _dotenv_values(env_file) if env_file else {}
        values = {key: os.environ[key] if key in os.environ else value for key, value in file_values.items()}
        for key in ENV_KEYS:
            if key in os.environ:
                values[key] = os.environ[key]
        origins = tuple(item.strip() for item in values.get("FILEACTION_ALLOWED_ORIGINS", "").split(",") if item.strip())
        hosts = tuple(item.strip() for item in values.get("FILEACTION_TRUSTED_HOSTS", "127.0.0.1,localhost").split(",") if item.strip())
        return cls(
            environment=values.get("FILEACTION_ENV", "development"),
            database_url=values.get("FILEACTION_DATABASE_URL"),
            auth_database_url=values.get("FILEACTION_AUTH_DATABASE_URL"),
            redis_url=values.get("FILEACTION_REDIS_URL"),
            app_secret=values.get("FILEACTION_APP_SECRET"),
            cos_region=values.get("FILEACTION_COS_REGION"),
            cos_bucket=values.get("FILEACTION_COS_BUCKET"),
            cos_prefix=values.get("FILEACTION_COS_PREFIX", "fileaction/"),
            cos_secret_id=values.get("FILEACTION_COS_SECRET_ID"),
            cos_secret_key=values.get("FILEACTION_COS_SECRET_KEY"),
            cos_session_token=values.get("FILEACTION_COS_SESSION_TOKEN"),
            cos_sse_mode=values.get("FILEACTION_COS_SSE_MODE"),
            cos_object_mode=values.get("FILEACTION_COS_OBJECT_MODE", "versioned"),
            embedding_base_url=values.get("FILEACTION_EMBEDDING_BASE_URL"),
            embedding_api_key=values.get("FILEACTION_EMBEDDING_API_KEY"),
            embedding_model=values.get("FILEACTION_EMBEDDING_MODEL"),
            embedding_dimensions=_int("FILEACTION_EMBEDDING_DIMENSIONS", values),
            embedding_profile_version=_int("FILEACTION_EMBEDDING_PROFILE_VERSION", values),
            embedding_max_batch_items=_int("FILEACTION_EMBEDDING_MAX_BATCH_ITEMS", values, 10) or 10,
            embedding_max_batch_tokens=_int("FILEACTION_EMBEDDING_MAX_BATCH_TOKENS", values),
            model_base_url=values.get("FILEACTION_MODEL_BASE_URL"),
            model_api_key=values.get("FILEACTION_MODEL_API_KEY"),
            model_name=values.get("FILEACTION_MODEL_NAME"),
            allowed_origins=origins,
            trusted_hosts=hosts,
            registration_enabled=_bool("FILEACTION_REGISTRATION_ENABLED", values),
            cookie_secure=_bool("FILEACTION_COOKIE_SECURE", values),
            test_model_mode=_bool("FILEACTION_TEST_MODEL_MODE", values),
        )

    def require_core(self) -> None:
        missing = [name for name, value in (("FILEACTION_DATABASE_URL", self.database_url), ("FILEACTION_AUTH_DATABASE_URL", self.auth_database_url), ("FILEACTION_REDIS_URL", self.redis_url), ("FILEACTION_APP_SECRET", self.app_secret)) if value is None or value == ""]
        if missing:
            raise ConfigurationError("缺少正式服务配置: " + ", ".join(missing))
        parsed = urlsplit(self.database_url or "")
        if parsed.scheme not in {"postgresql", "postgresql+psycopg", "postgres"}:
            raise ConfigurationError("FILEACTION_DATABASE_URL 必须使用 PostgreSQL")
        auth = urlsplit(self.auth_database_url or "")
        if auth.scheme not in {"postgresql", "postgresql+psycopg", "postgres"}:
            raise ConfigurationError("FILEACTION_AUTH_DATABASE_URL 必须使用 PostgreSQL")
        if parsed.username != "fileaction_app" or auth.username != "fileaction_auth_login":
            raise ConfigurationError("正式 API 必须使用 fileaction_app 与 fileaction_auth_login 受限角色")
        if self.environment not in {"development", "test", "production"}:
            raise ConfigurationError("FILEACTION_ENV 无效")
        if self.environment == "production" and not self.cookie_secure:
            raise ConfigurationError("production 要求 FILEACTION_COOKIE_SECURE=true")
        if self.environment != "test" and self.test_model_mode:
            raise ConfigurationError("FILEACTION_TEST_MODEL_MODE 只允许 test 环境")
        if self.embedding_dimensions is not None and not 1 <= self.embedding_dimensions <= 16000:
            raise ConfigurationError("FILEACTION_EMBEDDING_DIMENSIONS 超出范围")

    @property
    def cos_configured(self) -> bool:
        return all((self.cos_region, self.cos_bucket, self.cos_secret_id, self.cos_secret_key))

    @property
    def database_configured(self) -> bool:
        return bool(self.database_url)

    @property
    def redis_configured(self) -> bool:
        return bool(self.redis_url)
