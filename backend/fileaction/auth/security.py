from __future__ import annotations

import hashlib
import hmac
import re

from argon2 import PasswordHasher
from argon2.low_level import Type


_USERNAME = re.compile(r"[a-z0-9_.-]{3,32}\Z")


def normalize_username(value: str) -> str:
    normalized = value.lower()
    if not _USERNAME.fullmatch(normalized):
        raise ValueError("用户名须为3至32位小写字母、数字、下划线、点或连字符")
    return normalized


def validate_password(value: str) -> str:
    if not 12 <= len(value) <= 128 or len(value.encode("utf-8")) > 1024:
        raise ValueError("密码须为12至128字符且不超过1024字节")
    return value


def validate_display_name(value: str) -> str:
    if not 1 <= len(value.strip()) <= 40:
        raise ValueError("显示名须为1至40字符")
    return value.strip()


def password_hasher() -> PasswordHasher:
    return PasswordHasher(time_cost=3, memory_cost=65536, parallelism=1, hash_len=32, salt_len=16, type=Type.ID)


def sha256(value: str) -> str:
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


def csrf_for_session(secret: str, token: str) -> str:
    return hmac.new(secret.encode("utf-8"), ("session:" + token).encode("utf-8"), hashlib.sha256).hexdigest()


def csrf_for_nonce(secret: str, nonce: str) -> str:
    return hmac.new(secret.encode("utf-8"), ("anonymous:" + nonce).encode("utf-8"), hashlib.sha256).hexdigest()


def signed_nonce(secret: str, nonce: str) -> str:
    signature = hmac.new(secret.encode("utf-8"), ("nonce-cookie:" + nonce).encode("utf-8"), hashlib.sha256).hexdigest()
    return f"{nonce}.{signature}"


def read_signed_nonce(secret: str, cookie: str | None) -> str | None:
    if not cookie or "." not in cookie:
        return None
    nonce, signature = cookie.rsplit(".", 1)
    if not re.fullmatch(r"[a-f0-9]{64}", nonce):
        return None
    expected = signed_nonce(secret, nonce).rsplit(".", 1)[1]
    return nonce if hmac.compare_digest(signature, expected) else None
