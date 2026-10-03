"""Formal API routes; application wiring is intentionally owned by the main app."""
from fastapi import APIRouter, Depends, Query, Request
from sqlalchemy.exc import SQLAlchemyError

from fileaction.auth.dependencies import require_actor
from fileaction.auth.routes import envelope
from fileaction.auth.service import AuthError
from fileaction.db.session import ActorContext

from .dto import MemoryCreateRequest, MemoryPatchRequest, MemoryUseRequest, RetainRequest, RetentionPreviewRequest, RetainFactRequest
from .repository import MemoryRepository
from fileaction.workspaces.routes import service as workspace_service, operation as workspace_operation
from .service import MemoryService, RetentionError, RetentionService

router = APIRouter(tags=["retention"])


def retention_service(request: Request) -> RetentionService:
    service = getattr(request.app.state, "retention_service", None)
    if service is None:
        raise AuthError("DEPENDENCY_UNAVAILABLE", "保留服务尚未配置", 503)
    return service


def memory_service(request: Request) -> MemoryService:
    if request.app.state.database_sessions is None:
        raise AuthError("DEPENDENCY_UNAVAILABLE", "背景服务尚未配置", 503)
    return MemoryService(MemoryRepository(request.app.state.database_sessions,
                                          cursor_secret=request.app.state.settings.app_secret),
                         workspaces=workspace_service(request))


async def operation(awaitable):
    try:
        return await workspace_operation(awaitable)
    except SQLAlchemyError:
        raise AuthError("DEPENDENCY_UNAVAILABLE", "保留服务暂不可用，请稍后重试", 503) from None
    except RetentionError as exc:
        code = str(exc)
        status = 404 if code == "RESOURCE_NOT_FOUND" else 409 if code in {"REVISION_CONFLICT", "PREVIEW_STALE", "PREVIEW_EXPIRED", "IDEMPOTENCY_CONFLICT"} else 403 if code in {"CONSENT_REQUIRED", "FACT_NOT_ELIGIBLE"} else 503 if code in {"DEPENDENCY_UNAVAILABLE", "COS_NOT_CONFIGURED", "COS_UNAVAILABLE"} else 422
        messages = {
            "PREVIEW_STALE": "保留范围已变化，请重新预览",
            "PREVIEW_EXPIRED": "保留预览已过期，请重新预览",
            "FACT_NOT_ELIGIBLE": "只能从已确认且明确同意长期保存的背景创建独立背景",
            "MEMORY_NOT_AVAILABLE": "背景已停用、过期或来源已失效",
            "CONFIRMATION_REQUIRED": "请明确确认此操作",
        }
        raise AuthError(code, messages.get(code, "保留操作无法处理"), status) from None


@router.post("/api/v1/workspaces/{workspace_id}/retention-preview")
async def retention_preview(workspace_id: str, body: RetentionPreviewRequest, request: Request, actor: ActorContext = Depends(require_actor)):
    return envelope(request, await operation(retention_service(request).preview(actor, workspace_id, body)))


@router.post("/api/v1/workspaces/{workspace_id}/retain", status_code=202)
@router.post("/api/v1/workspaces/{workspace_id}/retention", status_code=202, include_in_schema=False)
async def retain(workspace_id: str, body: RetainRequest, request: Request, actor: ActorContext = Depends(require_actor)):
    key = request.headers.get("Idempotency-Key", "")
    return envelope(request, await operation(retention_service(request).retain(actor, workspace_id, body, key)), status=202)


@router.get("/api/v1/retention-batches/{batch_id}")
async def retention_batch(batch_id: str, request: Request, actor: ActorContext = Depends(require_actor)):
    repository = retention_service(request).repository
    if not hasattr(repository, "batch"):
        raise AuthError("DEPENDENCY_UNAVAILABLE", "保留状态服务尚未配置", 503)
    return envelope(request, await operation(repository.batch(actor, batch_id)))


@router.get("/api/v1/memories")
async def memories(request: Request, limit: int = Query(20, ge=1, le=100), cursor: str | None = Query(None, max_length=4096), actor: ActorContext = Depends(require_actor)):
    return envelope(request, await operation(memory_service(request).list(actor, limit=limit, cursor=cursor)))


@router.post("/api/v1/workspaces/{workspace_id}/facts/{fact_id}/retain", status_code=201)
async def retain_fact(workspace_id: str, fact_id: str, body: RetainFactRequest, request: Request,
                      actor: ActorContext = Depends(require_actor)):
    result = await operation(memory_service(request).retain_fact(
        actor, workspace_id, fact_id, body, request.headers.get("Idempotency-Key", "")))
    return envelope(request, result, status=201)


@router.post("/api/v1/memories", status_code=201)
async def create_memory(body: MemoryCreateRequest, request: Request, actor: ActorContext = Depends(require_actor)):
    return envelope(request, await operation(memory_service(request).create(actor, body)), status=201)


@router.get("/api/v1/memories/{memory_id}")
async def get_memory(memory_id: str, request: Request, actor: ActorContext = Depends(require_actor)):
    return envelope(request, await operation(memory_service(request).get(actor, memory_id)))


@router.patch("/api/v1/memories/{memory_id}")
async def patch_memory(memory_id: str, body: MemoryPatchRequest, request: Request, actor: ActorContext = Depends(require_actor)):
    return envelope(request, await operation(memory_service(request).patch(actor, memory_id, body)))


@router.delete("/api/v1/memories/{memory_id}")
async def delete_memory(memory_id: str, request: Request, confirmed: bool = False, expected_revision: int = Query(..., ge=1), actor: ActorContext = Depends(require_actor)):
    return envelope(request, await operation(memory_service(request).delete(actor, memory_id, expected_revision=expected_revision, confirmed=confirmed)))


@router.post("/api/v1/memories/{memory_id}/use")
async def use_memory(memory_id: str, body: MemoryUseRequest, request: Request, actor: ActorContext = Depends(require_actor)):
    return envelope(request, await operation(memory_service(request).use(
        actor, memory_id, body.workspace_id, body.expected_revision, body.expected_memory_revision)))
