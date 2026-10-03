from __future__ import annotations

from fastapi import Request

from fileaction.db.session import ActorContext

from .service import AuthError


async def require_actor(request: Request) -> ActorContext:
    actor = getattr(request.state, "actor", None)
    if actor is None:
        result = await request.app.state.auth.authenticate(request.cookies.get("fileaction_session"))
        if result is None:
            raise AuthError("AUTH_REQUIRED", "请先登录", 401)
        actor, user = result
        request.state.actor = actor
        request.state.user = user
    return actor


async def require_csrf(request: Request) -> None:
    if request.method in {"GET", "HEAD", "OPTIONS"}:
        return
    await require_actor(request)
    request.app.state.auth.check_session_csrf(
        request.cookies.get("fileaction_session", ""), request.headers.get("X-CSRF-Token")
    )
