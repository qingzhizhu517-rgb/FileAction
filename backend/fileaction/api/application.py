from __future__ import annotations

import asyncio
import sys
from contextlib import asynccontextmanager
from urllib.parse import urlsplit
from uuid import uuid4

from fastapi import FastAPI, HTTPException, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from redis.asyncio import Redis

from fileaction.auth.routes import envelope, router as auth_router
from fileaction.auth.service import AuthError, AuthService
from fileaction.documents.routes import router as documents_router
from fileaction.workspaces.routes import router as workspaces_router
from fileaction.runs.routes import router as runs_router
from fileaction.indexing.routes import router as indexing_router
from fileaction.actions.routes import router as actions_router
from fileaction.artifacts.routes import router as artifacts_router
from fileaction.core.config import Settings
from fileaction.core.errors import ConfigurationError
from fileaction.api.readiness import ReadinessProbes
from fileaction.db.session import create_session_factory


def _error(code: str, message: str, status: int, request_id: str = "", details: dict | None = None) -> JSONResponse:
    payload = {"code": code, "message": message, "request_id": request_id}
    if details is not None:
        payload["details"] = details
    return JSONResponse({"error": payload}, status_code=status)


def _origin_ok(origin: str, settings: Settings, request: Request) -> bool:
    try:
        parsed = urlsplit(origin)
        if parsed.scheme not in {"http", "https"} or not parsed.netloc or parsed.username or parsed.password or parsed.path or parsed.query or parsed.fragment:
            return False
        own = f"{request.url.scheme}://{request.headers['host']}"
        return origin == own or origin in settings.allowed_origins
    except (ValueError, KeyError):
        return False


def create_app(settings: Settings, services: object | None = None) -> FastAPI:
    if sys.platform == "win32":
        asyncio.set_event_loop_policy(asyncio.WindowsSelectorEventLoopPolicy())

    @asynccontextmanager
    async def lifespan(_: FastAPI):
        try:
            yield
        finally:
            await app.state.auth.close()
            if app.state.database_sessions is not None:
                await app.state.database_sessions.kw["bind"].dispose()

    app = FastAPI(title="文启 FileAction API", version="1.0.0", docs_url="/api/v1/docs",
                  openapi_url="/api/v1/openapi.json", lifespan=lifespan)
    app.state.settings = settings
    app.state.services = services or ReadinessProbes()
    try:
        settings.require_core()
        app.state.database_sessions = create_session_factory(settings)
        app.state.redis = Redis.from_url(settings.redis_url, socket_connect_timeout=2, socket_timeout=2)
    except ConfigurationError:
        app.state.database_sessions = None
        app.state.redis = None
    app.state.auth = AuthService(settings, app.state.redis)

    @app.middleware("http")
    async def request_guards(request: Request, call_next):
        request.state.request_id = str(uuid4())
        raw_host = request.headers.get("host", "")
        try:
            parsed_host = urlsplit("http://" + raw_host)
            host = parsed_host.hostname
        except ValueError:
            host = None
            parsed_host = None
        if (host not in settings.trusted_hosts or "@" in raw_host or parsed_host is None
                or parsed_host.path or parsed_host.query or parsed_host.fragment):
            return _error("UNTRUSTED_HOST", "请求主机不受允许", 400, request.state.request_id)
        origin = request.headers.get("origin")
        if origin and not _origin_ok(origin, settings, request):
            return _error("CSRF_REJECTED", "请求来源不受允许", 403, request.state.request_id)
        try:
            if request.url.path.startswith("/api/v1/") and request.method not in {"GET", "HEAD", "OPTIONS"}:
                service = app.state.auth
                if request.url.path in {"/api/v1/auth/register", "/api/v1/auth/login"}:
                    await service.consume_anonymous_csrf(request.cookies.get("fileaction_prelogin"),
                                                         request.headers.get("X-CSRF-Token"))
                else:
                    token = request.cookies.get("fileaction_session")
                    authenticated = await service.authenticate(token)
                    if authenticated is None:
                        raise AuthError("AUTH_REQUIRED", "请先登录", 401)
                    request.state.actor, request.state.user = authenticated
                    service.check_session_csrf(token, request.headers.get("X-CSRF-Token"))
            response = await call_next(request)
            response.headers["X-Request-ID"] = request.state.request_id
            return response
        except AuthError as exc:
            return _error(exc.code, exc.message, exc.status, request.state.request_id, exc.details)

    @app.exception_handler(AuthError)
    async def auth_error(request: Request, exc: AuthError):
        return _error(exc.code, exc.message, exc.status, request.state.request_id, exc.details)

    @app.exception_handler(RequestValidationError)
    async def validation_error(request: Request, _: RequestValidationError):
        return _error("INVALID_REQUEST", "请求参数无效，请检查后重试", 422, request.state.request_id)

    @app.exception_handler(HTTPException)
    async def http_error(request: Request, exc: HTTPException):
        return _error("RESOURCE_NOT_FOUND" if exc.status_code == 404 else "INVALID_REQUEST",
                      "资源不存在" if exc.status_code == 404 else "请求无法处理", exc.status_code, request.state.request_id)

    @app.exception_handler(Exception)
    async def internal_error(request: Request, _: Exception):
        return _error("INTERNAL_ERROR", "服务暂时无法处理请求", 500, request.state.request_id)

    app.include_router(auth_router)
    app.include_router(documents_router)
    app.include_router(workspaces_router)
    app.include_router(runs_router)
    app.include_router(indexing_router)
    app.include_router(actions_router)
    app.include_router(artifacts_router)

    @app.get("/api/v1/config", tags=["config"])
    async def config(request: Request):
        from fileaction.auth.dependencies import require_actor
        await require_actor(request)
        def domain(value: str | None) -> str | None:
            return urlsplit(value).hostname if value else None
        return envelope(request, {
            "generation": {"configured": bool(settings.model_base_url and settings.model_api_key and settings.model_name),
                           "model": settings.model_name, "domain": domain(settings.model_base_url)},
            "embedding": {"configured": bool(settings.embedding_base_url and settings.embedding_api_key and settings.embedding_model),
                          "model": settings.embedding_model, "domain": domain(settings.embedding_base_url)},
            "cos": {"configured": bool(settings.cos_configured), "region": settings.cos_region},
            "storage_notice_version": "1",
        })

    @app.get("/api/v1/health/live", tags=["health"])
    async def live() -> dict[str, str]:
        return {"status": "live"}

    @app.get("/api/v1/health/ready", tags=["health"], response_model=None)
    async def ready():
        if not settings.database_configured or not settings.auth_database_url or not settings.redis_configured or not settings.cos_configured:
            return _error("DEPENDENCY_UNAVAILABLE", "依赖服务尚未配置", 503)
        try:
            settings.require_core()
            probes = app.state.services
            for name in ("database", "redis", "cos"):
                if not await getattr(probes, name)(settings):
                    return _error("DEPENDENCY_UNAVAILABLE", "依赖服务尚未就绪", 503)
        except Exception:
            return _error("DEPENDENCY_UNAVAILABLE", "依赖服务尚未就绪", 503)
        return {"status": "ready"}

    return app


app = create_app(Settings.from_environment())
