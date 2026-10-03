from urllib.parse import quote
from fastapi import APIRouter, Depends, Query, Request, Response, Body
from fileaction.auth.dependencies import require_actor
from fileaction.auth.routes import envelope
from fileaction.auth.service import AuthError
from fileaction.db.session import ActorContext
from fileaction.storage_adapters.cos import CosBlobStore, CosConfiguration, StorageError
from fileaction.storage_adapters.temporary import TemporaryStore, TemporaryError
from .multipart import read_upload, UploadError
from .repository import DocumentRepository
from .service import DocumentService, DocumentError
from .dto import DocumentMetadataPatch, DocumentDeleteRequest


router = APIRouter(prefix="/api/v1/documents", tags=["documents"])


def service(request: Request) -> DocumentService:
    if request.app.state.redis is None or request.app.state.database_sessions is None:
        raise AuthError("DEPENDENCY_UNAVAILABLE", "存储服务尚未配置", 503)
    settings = request.app.state.settings
    cos = None
    if settings.cos_configured:
        from qcloud_cos import CosConfig, CosS3Client
        config = CosConfig(Region=settings.cos_region, SecretId=settings.cos_secret_id, SecretKey=settings.cos_secret_key, Token=settings.cos_session_token, Scheme="https", Timeout=20)
        cos = CosBlobStore(CosConfiguration(settings.cos_bucket, settings.cos_region, settings.cos_prefix, settings.cos_sse_mode or "AES256"), CosS3Client(config, retry=0))
    return DocumentService(TemporaryStore(request.app.state.redis), DocumentRepository(request.app.state.database_sessions, settings.cos_bucket or "", cursor_secret=settings.app_secret), cos, cursor_secret=settings.app_secret)


async def operation(awaitable):
    try:
        return await awaitable
    except (DocumentError, UploadError, TemporaryError, StorageError) as error:
        code = str(error)
        if code == "TEMPORARY_MIGRATION_REQUIRED":
            raise AuthError(code, "临时内容账目待整理，暂不能新增内容；已有内容仍可读取或结束", 503) from None
        status = 404 if code in {"RESOURCE_NOT_FOUND", "TEMPORARY_CONTENT_EXPIRED"} else 413 if code in {"FILE_TOO_LARGE", "QUOTA_EXCEEDED"} else 429 if code == "UPLOAD_LIMIT_EXCEEDED" else 408 if code == "UPLOAD_TIMEOUT" else 403 if code in {"CONSENT_REQUIRED", "SESSION_REVOKED"} else 503 if code in {"DEPENDENCY_UNAVAILABLE", "COS_NOT_CONFIGURED", "COS_UNAVAILABLE"} else 409 if code in {"REVISION_CONFLICT", "CONFIRMATION_REQUIRED"} else 400
        messages = {"RESOURCE_NOT_FOUND": "文件不存在或已失效", "FILE_TOO_LARGE": "文件为空或超过10 MiB限制", "DOCUMENT_PARSE_FAILED": "无法解析文件，请使用TXT、Markdown、文本PDF或DOCX", "CONSENT_REQUIRED": "保存到云端需要确认当前存储说明", "COS_NOT_CONFIGURED": "云存储尚未配置，可以选择仅本次使用", "DEPENDENCY_UNAVAILABLE": "存储服务暂不可用", "QUOTA_EXCEEDED": "本账号文件或原件容量已达上限，请结束不再使用的内容后重试", "UPLOAD_LIMIT_EXCEEDED": "本账号已有两个文件正在上传，请稍后重试", "UPLOAD_TIMEOUT": "上传处理超时，请重试", "REVISION_CONFLICT": "文件已改变，请刷新后重新确认", "CONFIRMATION_REQUIRED": "请明确确认此操作"}
        raise AuthError(code, messages.get(code, "文件操作失败，请重试"), status) from None


@router.get("")
async def list_documents(request: Request, actor: ActorContext = Depends(require_actor),
                         limit: int = Query(20, ge=1, le=100), cursor: str | None = Query(None, max_length=4096),
                         q: str = Query("", max_length=100), category: str = Query("", max_length=32)):
    return envelope(request, await operation(service(request).list_retained(actor, limit=limit, cursor=cursor, query=q, category=category)))


@router.post("", status_code=202)
async def upload_document(request: Request, actor: ActorContext = Depends(require_actor)):
    documents = service(request)
    async def accept():
        async with documents.temporary.upload_slot(actor):
            upload = await read_upload(request.stream(), request.headers.get("content-type", ""))
            if upload.fields.get("consent_to_store", "false") not in {"true", "false"}:
                raise AuthError("UPLOAD_INVALID", "云存储确认值无效", 422)
            return await documents.upload(actor, upload.filename, upload.content, retention=upload.fields.get("retention", "temporary"), consent_to_store=upload.fields.get("consent_to_store") == "true", storage_notice_version=upload.fields.get("storage_notice_version", ""))
    result = await operation(accept())
    return envelope(request, result, status=202)


@router.patch("/{document_id}")
async def patch_document(document_id: str, body: DocumentMetadataPatch, request: Request,
                         actor: ActorContext = Depends(require_actor)):
    return envelope(request, await operation(service(request).patch_metadata(actor, document_id,
        name=body.name, category=body.category, expected_revision=body.expected_revision)))


@router.post("/{document_id}/versions", status_code=202)
async def upload_version(document_id: str, request: Request, actor: ActorContext = Depends(require_actor)):
    documents = service(request)
    async def accept():
        async with documents.temporary.upload_slot(actor):
            upload = await read_upload(request.stream(), request.headers.get("content-type", ""))
            raw_revision = upload.fields.get("expected_revision", "")
            try:
                revision = int(raw_revision)
            except (TypeError, ValueError):
                raise DocumentError("INVALID_REQUEST") from None
            return await documents.upload_version(actor, document_id, upload.filename, upload.content,
                                                  expected_revision=revision)
    return envelope(request, await operation(accept()), status=202)


@router.get("/{document_id}")
async def get_document(document_id: str, request: Request, actor: ActorContext = Depends(require_actor)):
    return envelope(request, await operation(service(request).get(actor, document_id)))


@router.get("/{document_id}/segments")
async def get_segments(document_id: str, request: Request, actor: ActorContext = Depends(require_actor),
                       limit: int = Query(20, ge=1, le=100), cursor: str | None = Query(None, max_length=4096)):
    if "limit" not in request.query_params and "cursor" not in request.query_params:
        return envelope(request, await operation(service(request).segments(actor, document_id)))
    return envelope(request, await operation(service(request).segments(actor, document_id, limit=limit, cursor=cursor)))


@router.get("/{document_id}/source")
async def get_source(document_id: str, request: Request, actor: ActorContext = Depends(require_actor)):
    documents = service(request)
    meta = await operation(documents.get(actor, document_id))
    range_header = request.headers.get("range")
    byte_range = None
    status = 200
    headers = {"Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff", "Accept-Ranges": "bytes"}
    if range_header:
        try:
            if not range_header.startswith("bytes=") or "," in range_header:
                raise ValueError
            value = range_header[6:]
            left, right = value.split("-", 1)
            size = int(meta.get("size_bytes") or 0)
            if not size:
                raise ValueError
            if left == "":
                length = int(right)
                if length <= 0:
                    raise ValueError
                start, end = max(0, size - length), size - 1
            else:
                start = int(left)
                end = size - 1 if right == "" else int(right)
                if start < 0 or end < start:
                    raise ValueError
                end = min(end, size - 1)
            if start >= size:
                return Response(status_code=416, headers={"Content-Range": f"bytes */{size}"})
            byte_range = (start, end)
            status = 206
            headers["Content-Range"] = f"bytes {start}-{end}/{size}"
            headers["Accept-Ranges"] = "bytes"
        except (ValueError, TypeError):
            return Response(status_code=416, headers={"Content-Range": f"bytes */{meta.get('size_bytes', 0)}"})
    content = await operation(documents.source(actor, document_id, byte_range))
    filename = "".join(c for c in meta["name"] if ord(c) >= 32 and c not in '\r\n"\\/')[:200] or "document"
    headers["Content-Disposition"] = "attachment; filename*=UTF-8''" + quote(filename)
    return Response(content, status_code=status, media_type=meta.get("mime_type") or "application/octet-stream", headers=headers)


@router.get("/{document_id}/deletion-impact")
async def deletion_impact(document_id: str, request: Request, actor: ActorContext = Depends(require_actor)):
    return envelope(request, await operation(service(request).deletion_impact(actor, document_id)))


@router.delete("/{document_id}", status_code=202)
async def delete_document(document_id: str, request: Request, body: DocumentDeleteRequest = Body(...),
                          actor: ActorContext = Depends(require_actor)):
    return envelope(request, await operation(service(request).delete(actor, document_id,
        expected_revision=body.expected_revision, impact_hash=body.impact_hash, confirmed=body.confirmed)), status=202)
