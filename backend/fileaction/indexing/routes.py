"""索引端点复用登录、CSRF与统一错误信封。"""
from fastapi import APIRouter,Depends,Request,Header
from fileaction.auth.dependencies import require_actor
from fileaction.auth.routes import envelope
from fileaction.auth.service import AuthError
from fileaction.db.session import ActorContext
from fileaction.documents.routes import service as documents_service
from fileaction.documents.service import DocumentError
from fileaction.storage_adapters.temporary import TemporaryError
from .dto import IndexPreviewRequest,IndexCreateRequest,ConfirmRequest,DeleteIndexesRequest
from .embedding import EmbeddingProfile,EmbeddingError
from .repository import IndexRepository
from .service import IndexingService,IndexingError

router=APIRouter(prefix='/api/v1',tags=['indexes'])

def configured_profile(settings):
    values=(settings.embedding_base_url,settings.embedding_api_key,settings.embedding_model,settings.embedding_dimensions,settings.embedding_profile_version)
    if not all(values): return None
    return EmbeddingProfile(settings.embedding_base_url,settings.embedding_api_key,settings.embedding_model,settings.embedding_dimensions,str(settings.embedding_profile_version),settings.embedding_max_batch_items,settings.embedding_max_batch_tokens or 32000)

def service(request):
    docs=documents_service(request)
    return IndexingService(docs.temporary,docs,IndexRepository(request.app.state.database_sessions),configured_profile(request.app.state.settings))

async def operation(awaitable):
    try: return await awaitable
    except (IndexingError,EmbeddingError,TemporaryError,DocumentError) as error:
        code=str(error)
        status=404 if code in ('RESOURCE_NOT_FOUND','TEMPORARY_CONTENT_EXPIRED') else 403 if code in ('CONSENT_REQUIRED','SESSION_REVOKED','CONFIRMATION_REQUIRED') else 429 if code=='INDEX_LIMIT_EXCEEDED' else 413 if code in ('QUOTA_EXCEEDED','EMBEDDING_INPUT_TOO_LARGE') else 503 if code in ('DEPENDENCY_UNAVAILABLE','EMBEDDING_NOT_CONFIGURED','EMBEDDING_PROFILE_MISMATCH') else 409 if code in ('PREVIEW_EXPIRED','PREVIEW_STALE','REVISION_CONFLICT','IDEMPOTENCY_CONFLICT','RETRY_SCOPE_CHANGED','INDEX_NOT_ACTIVE') else 400
        messages={'CONSENT_REQUIRED':'需要单独确认将所选片段发送给Embedding服务','PREVIEW_EXPIRED':'索引预览已过期，请重新预览','PREVIEW_STALE':'文件、范围或Embedding配置已变化，请重新预览','EMBEDDING_NOT_CONFIGURED':'Embedding服务尚未配置','INDEX_LIMIT_EXCEEDED':'本账号已有索引任务，请等待完成或取消','COST_ACKNOWLEDGEMENT_REQUIRED':'上次请求费用未知，请明确确认后重试','QUOTA_EXCEEDED':'索引或临时内容达到本账号容量限制'}
        raise AuthError(code,messages.get(code,'索引操作未完成，请检查状态后重试'),status) from None

@router.post('/documents/{document_id}/index-preview')
async def preview(document_id:str,body:IndexPreviewRequest,request:Request,actor:ActorContext=Depends(require_actor)):
    return envelope(request,await operation(service(request).preview(actor,document_id,body)))

@router.post('/documents/{document_id}/indexes',status_code=202)
async def create(document_id:str,body:IndexCreateRequest,request:Request,actor:ActorContext=Depends(require_actor),idempotency_key:str=Header(...,min_length=1,max_length=160)):
    return envelope(request,await operation(service(request).create(actor,document_id,idempotency_key,body.model_dump())),status=202)

@router.get('/index-jobs/{job_id}')
async def get(job_id:str,request:Request,actor:ActorContext=Depends(require_actor)):
    return envelope(request,await operation(service(request).get(actor,job_id)))

@router.post('/index-jobs/{job_id}/cancel')
async def cancel(job_id:str,body:ConfirmRequest,request:Request,actor:ActorContext=Depends(require_actor)):
    return envelope(request,await operation(service(request).cancel(actor,job_id,body.confirmed)))

@router.delete('/documents/{document_id}/indexes')
async def remove(document_id:str,body:DeleteIndexesRequest,request:Request,actor:ActorContext=Depends(require_actor)):
    return envelope(request,await operation(service(request).delete_indexes(actor,document_id,body.expected_revision,body.confirmed)))
