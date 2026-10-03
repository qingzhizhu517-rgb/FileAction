from __future__ import annotations

import hmac
import secrets
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
from uuid import uuid4

from argon2.exceptions import VerifyMismatchError, VerificationError
from redis.asyncio import Redis
from sqlalchemy import text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from fileaction.core.config import Settings
from fileaction.db.session import ActorContext
from fileaction.storage_adapters.temporary import TemporaryError, TemporaryStore

from .security import (csrf_for_nonce, csrf_for_session, normalize_username,
                       password_hasher, read_signed_nonce, sha256,
                       signed_nonce, validate_display_name, validate_password)


SESSION_AGE = timedelta(days=7)
SESSION_IDLE = timedelta(hours=24)
NONCE_AGE = 600


@dataclass(frozen=True)
class AuthError(Exception):
    code: str
    message: str
    status: int
    details: dict | None = None


def public_user(user) -> dict:
    return {"id": str(user.id), "username": user.username_normalized,
            "display_name": user.display_name, "revision": user.revision}


class AuthService:
    def __init__(self, settings: Settings, redis: Redis | None = None):
        self.settings = settings
        self.engine = None
        self.factory = None
        self.redis = redis
        self.hasher = password_hasher()

    def _open(self):
        if self.factory is not None:
            return
        try:
            self.settings.require_core()
            self.engine = create_async_engine(self.settings.auth_database_url, pool_pre_ping=True)
            self.factory = async_sessionmaker(self.engine, expire_on_commit=False)
            if self.redis is None:
                self.redis = Redis.from_url(self.settings.redis_url, socket_connect_timeout=2, socket_timeout=2)
        except Exception:
            raise AuthError("DEPENDENCY_UNAVAILABLE", "认证服务尚未就绪", 503) from None

    async def close(self):
        if self.redis is not None:
            await self.redis.aclose()
        if self.engine is not None:
            await self.engine.dispose()

    async def _rate(self, key: str, limit: int, seconds: int):
        self._open()
        script = "local n=redis.call('INCR',KEYS[1]); if n==1 then redis.call('EXPIRE',KEYS[1],ARGV[1]) end; return n"
        try:
            count = await self.redis.eval(script, 1, "auth-rate:" + sha256(key), seconds)
        except Exception:
            raise AuthError("DEPENDENCY_UNAVAILABLE", "认证服务尚未就绪", 503) from None
        if count > limit:
            raise AuthError("RATE_LIMITED", "请求过于频繁，请稍后再试", 429)

    async def anonymous_csrf(self) -> tuple[str, str]:
        self._open()
        nonce = secrets.token_hex(32)
        try:
            await self.redis.set("auth-nonce:" + sha256(nonce), "1", ex=NONCE_AGE)
        except Exception:
            raise AuthError("DEPENDENCY_UNAVAILABLE", "认证服务尚未就绪", 503) from None
        return csrf_for_nonce(self.settings.app_secret, nonce), signed_nonce(self.settings.app_secret, nonce)

    async def consume_anonymous_csrf(self, cookie: str | None, submitted: str | None):
        nonce = read_signed_nonce(self.settings.app_secret, cookie)
        if not nonce or not submitted or not hmac.compare_digest(csrf_for_nonce(self.settings.app_secret, nonce), submitted):
            raise AuthError("CSRF_REJECTED", "请求验证失败，请刷新后重试", 403)
        self._open()
        try:
            used = await self.redis.getdel("auth-nonce:" + sha256(nonce))
        except Exception:
            raise AuthError("DEPENDENCY_UNAVAILABLE", "认证服务尚未就绪", 503) from None
        if used is None:
            raise AuthError("CSRF_REJECTED", "请求验证失败，请刷新后重试", 403)

    async def register(self, username: str, password: str, display_name: str, ip: str) -> dict:
        if not self.settings.registration_enabled:
            raise AuthError("REGISTRATION_DISABLED", "当前未开放注册", 403)
        await self._rate("register-ip:" + ip, 5, 3600)
        try:
            username = normalize_username(username)
            password = validate_password(password)
            display_name = validate_display_name(display_name)
        except ValueError as exc:
            raise AuthError("INVALID_INPUT", str(exc), 400) from None
        encoded = self.hasher.hash(password)
        self._open()
        try:
            async with self.factory() as db:
                async with db.begin():
                    user = (await db.execute(text("SELECT * FROM public.fa_auth_register(:id, :username, :display, :password_hash)"),
                                             {"id": uuid4(), "username": username, "display": display_name,
                                              "password_hash": encoded})).mappings().one()
                    result = public_user(SimpleNamespace(**user))
            return result
        except IntegrityError:
            raise AuthError("USERNAME_TAKEN", "用户名已被使用", 409) from None

    async def login(self, username: str, password: str, ip: str) -> tuple[dict, str, str]:
        normalized = username.lower()
        await self._rate("login-ip:" + ip, 20, 300)
        await self._rate("login-user:" + normalized, 10, 900)
        self._open()
        try:
            async with self.factory() as db:
                user = (await db.execute(text("SELECT * FROM public.fa_auth_find_user(:username)"),
                                         {"username": normalized})).mappings().one_or_none()
            valid = bool(user and not user["disabled_at"] and self.hasher.verify(user["password_hash"], password))
        except (VerifyMismatchError, VerificationError):
            valid = False
        except Exception:
            raise AuthError("DEPENDENCY_UNAVAILABLE", "认证服务尚未就绪", 503) from None
        if not valid:
            raise AuthError("INVALID_CREDENTIALS", "账号或密码错误", 401)
        token = secrets.token_urlsafe(48)
        csrf = csrf_for_session(self.settings.app_secret, token)
        async with self.factory() as db:
            async with db.begin():
                created = (await db.execute(text("SELECT id FROM public.fa_auth_create_session(:id, :user_id, :expected_hash, :token_hash, :csrf_hash, :expires)"),
                                            {"id": uuid4(), "user_id": user["id"],
                                             "expected_hash": user["password_hash"], "token_hash": sha256(token),
                                             "csrf_hash": sha256(csrf), "expires": datetime.now(timezone.utc) + SESSION_AGE})).first()
                if created is None:
                    raise AuthError("INVALID_CREDENTIALS", "账号或密码错误", 401)
        return public_user(SimpleNamespace(**user)), token, csrf

    async def authenticate(self, token: str | None) -> tuple[ActorContext, User] | None:
        if not token:
            return None
        self._open()
        try:
            async with self.factory() as db:
                async with db.begin():
                    row = (await db.execute(text("SELECT * FROM public.fa_auth_authenticate(:token_hash)"),
                                            {"token_hash": sha256(token)})).mappings().one_or_none()
                    if not row:
                        return None
                    user = SimpleNamespace(id=row["user_id"], username_normalized=row["username_normalized"],
                                           display_name=row["display_name"], revision=row["revision"])
                    return ActorContext(row["user_id"], row["session_id"]), user
        except AuthError:
            raise
        except Exception:
            raise AuthError("DEPENDENCY_UNAVAILABLE", "认证服务尚未就绪", 503) from None

    def check_session_csrf(self, token: str, submitted: str | None):
        if not submitted or not hmac.compare_digest(csrf_for_session(self.settings.app_secret, token), submitted):
            raise AuthError("CSRF_REJECTED", "请求验证失败，请刷新后重试", 403)

    async def profile(self, actor: ActorContext, token: str, display_name: str, revision: int) -> dict:
        try:
            name = validate_display_name(display_name)
        except ValueError as exc:
            raise AuthError("INVALID_INPUT", str(exc), 400) from None
        self._open()
        async with self.factory() as db:
            async with db.begin():
                user = (await db.execute(text("SELECT * FROM public.fa_auth_profile(:token_hash, :revision, :display)"),
                                         {"token_hash": sha256(token), "revision": revision,
                                          "display": name})).mappings().one_or_none()
                if not user:
                    raise AuthError("WORKSPACE_REVISION_CONFLICT", "资料已发生变化，请刷新后重试", 409)
                return public_user(SimpleNamespace(**user))

    async def revoke(self, actor: ActorContext, token: str):
        self._open()
        async with self.factory() as db:
            async with db.begin():
                await db.execute(text("SELECT session_id FROM public.fa_auth_logout(:token_hash)"),
                                 {"token_hash": sha256(token)})
        try:
            await TemporaryStore(self.redis).end_session(actor)
        except TemporaryError:
            raise AuthError("DEPENDENCY_UNAVAILABLE", "临时资料清理尚未完成", 503) from None

    async def change_password(self, actor: ActorContext, token: str, username: str, current: str, new: str):
        try:
            validate_password(new)
        except ValueError as exc:
            raise AuthError("INVALID_INPUT", str(exc), 400) from None
        self._open()
        async with self.factory() as db:
            async with db.begin():
                user = (await db.execute(text("SELECT * FROM public.fa_auth_find_user(:username)"),
                                         {"username": username})).mappings().one_or_none()
                try:
                    verified = bool(user and user["id"] == actor.user_id and self.hasher.verify(user["password_hash"], current))
                except (VerifyMismatchError, VerificationError):
                    verified = False
                if not verified:
                    raise AuthError("INVALID_CREDENTIALS", "账号或密码错误", 401)
                ids = (await db.execute(text("SELECT session_id FROM public.fa_auth_change_password(:token_hash, :expected_hash, :new_hash)"),
                                        {"token_hash": sha256(token), "expected_hash": user["password_hash"],
                                         "new_hash": self.hasher.hash(new)})).scalars().all()
                if not ids:
                    raise AuthError("AUTH_REQUIRED", "请重新登录", 401)
        for session_id in ids:
            try:
                await TemporaryStore(self.redis).end_session(ActorContext(actor.user_id, session_id))
            except TemporaryError:
                raise AuthError("DEPENDENCY_UNAVAILABLE", "临时资料清理尚未完成", 503) from None
