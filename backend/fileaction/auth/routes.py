from __future__ import annotations

from fastapi import APIRouter, Depends, Request, Response
from pydantic import BaseModel, ConfigDict, Field

from fileaction.core.config import Settings
from fileaction.db.session import ActorContext

from .dependencies import require_actor
from .service import AuthError, public_user


router = APIRouter(prefix="/api/v1/auth", tags=["auth"])


class Input(BaseModel):
    model_config = ConfigDict(extra="forbid")


class Register(Input):
    username: str
    password: str
    display_name: str


class Login(Input):
    username: str
    password: str


class Profile(Input):
    display_name: str
    expected_revision: int = Field(ge=1)


class Password(Input):
    current_password: str
    new_password: str


class DeleteAccount(Input):
    current_password: str
    confirm_delete: bool


def envelope(request: Request, data: object, *, status: int = 200) -> Response:
    from fastapi.responses import JSONResponse
    return JSONResponse({"data": data, "request_id": request.state.request_id}, status_code=status)


def cookie_options(settings: Settings) -> dict:
    return {"httponly": True, "samesite": "lax", "secure": settings.cookie_secure, "path": "/"}


@router.get("/csrf")
async def csrf(request: Request):
    service = request.app.state.auth
    token = request.cookies.get("fileaction_session")
    authenticated = await service.authenticate(token)
    if authenticated:
        from .security import csrf_for_session
        return envelope(request, {"csrf_token": csrf_for_session(service.settings.app_secret, token)})
    csrf_token, nonce_cookie = await service.anonymous_csrf()
    response = envelope(request, {"csrf_token": csrf_token})
    response.set_cookie("fileaction_prelogin", nonce_cookie, max_age=600, **cookie_options(service.settings))
    return response


@router.post("/register", status_code=201)
async def register(request: Request, body: Register):
    user = await request.app.state.auth.register(body.username, body.password, body.display_name,
                                                 request.client.host if request.client else "unknown")
    response = envelope(request, user, status=201)
    response.delete_cookie("fileaction_prelogin", path="/")
    return response


@router.post("/login")
async def login(request: Request, body: Login):
    user, token, csrf_token = await request.app.state.auth.login(body.username, body.password,
                                                                 request.client.host if request.client else "unknown")
    response = envelope(request, {"user": user, "csrf_token": csrf_token})
    response.set_cookie("fileaction_session", token, max_age=7 * 86400,
                        **cookie_options(request.app.state.settings))
    response.delete_cookie("fileaction_prelogin", path="/")
    return response


@router.post("/logout", status_code=204)
async def logout(request: Request, actor: ActorContext = Depends(require_actor)):
    await request.app.state.auth.revoke(actor, request.cookies["fileaction_session"])
    response = Response(status_code=204)
    response.delete_cookie("fileaction_session", path="/")
    return response


@router.get("/me")
async def me(request: Request, actor: ActorContext = Depends(require_actor)):
    return envelope(request, public_user(request.state.user))


@router.patch("/profile")
async def profile(request: Request, body: Profile, actor: ActorContext = Depends(require_actor)):
    user = await request.app.state.auth.profile(actor, request.cookies["fileaction_session"], body.display_name, body.expected_revision)
    return envelope(request, user)


@router.post("/password", status_code=204)
async def password(request: Request, body: Password, actor: ActorContext = Depends(require_actor)):
    await request.app.state.auth.change_password(actor, request.cookies["fileaction_session"],
                                                 request.state.user.username_normalized,
                                                 body.current_password, body.new_password)
    response = Response(status_code=204)
    response.delete_cookie("fileaction_session", path="/")
    return response


@router.delete("/account")
async def account(request: Request, body: DeleteAccount, actor: ActorContext = Depends(require_actor)):
    raise AuthError("DEPENDENCY_UNAVAILABLE", "账户清除服务尚未就绪", 503)
