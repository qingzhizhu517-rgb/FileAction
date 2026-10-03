from fastapi import APIRouter, Depends, Request
from redis.exceptions import RedisError
from sqlalchemy.exc import SQLAlchemyError
from fileaction.auth.dependencies import require_actor
from fileaction.auth.routes import envelope
from fileaction.auth.service import AuthError
from fileaction.db.session import ActorContext
from fileaction.documents.routes import service as document_service
from fileaction.documents.service import DocumentError
from fileaction.storage_adapters.temporary import TemporaryError
from .service import WorkspaceService, WorkspaceError
from .repository import WorkspaceRepository
from .dto import CreateRequest, PatchRequest, DocumentsRequest, FactRequest, RevisionRequest, PreviewRequest
from fileaction.indexing.routes import configured_profile
from fileaction.indexing.service import IndexingService
from fileaction.indexing.repository import IndexRepository
from fileaction.retrieval.provider import RetrievalProvider

router = APIRouter(prefix='/api/v1/workspaces', tags=['workspaces'])

def service(request):
    docs = document_service(request)
    indexing = IndexingService(
        docs.temporary, docs,
        IndexRepository(request.app.state.database_sessions),
        configured_profile(request.app.state.settings),
    )
    return WorkspaceService(
        docs.temporary, docs, request.app.state.settings,
        WorkspaceRepository(request.app.state.database_sessions, request.app.state.settings.app_secret),
        retrieval=RetrievalProvider(indexing),
    )

async def operation(task):
    try:
        return await task
    except (SQLAlchemyError, RedisError):
        raise AuthError('DEPENDENCY_UNAVAILABLE', '存储服务暂不可用，请稍后重试', 503) from None
    except (WorkspaceError, DocumentError, TemporaryError) as exc:
        code = str(exc)
        if code == 'TEMPORARY_MIGRATION_REQUIRED':
            raise AuthError(code, '临时内容账目待整理，暂不能新增内容；已有内容仍可读取或结束', 503) from None
        status = 404 if code in {'RESOURCE_NOT_FOUND','TEMPORARY_CONTENT_EXPIRED'} else 409 if code in {'WORKSPACE_ENDING','REVISION_CONFLICT','PREVIEW_EXPIRED','PREVIEW_STALE','SOURCE_CHANGED','MESSAGE_SEQUENCE_CONFLICT','INDEX_CHANGED'} else 503 if code in {'DEPENDENCY_UNAVAILABLE','HYBRID_UNAVAILABLE','EMBEDDING_NOT_CONFIGURED','INDEX_NOT_READY'} else 413 if code in {'CONTEXT_BUDGET_EXCEEDED','QUOTA_EXCEEDED'} else 422
        messages = {'WORKSPACE_ENDING':'工作区结束处理中，请重试结束以完成清理', 'RESOURCE_NOT_FOUND':'工作区或材料不存在，或当前会话已失效', 'REVISION_CONFLICT':'内容已更新，请刷新后重试', 'PREVIEW_EXPIRED':'预览已过期，请重新查看发送范围', 'PREVIEW_STALE':'发送范围或模型已变化，请重新预览', 'SOURCE_CHANGED':'文件来源已变化，请重新选择材料', 'HYBRID_UNAVAILABLE':'语义索引尚未接入，请明确选择全文或关键词模式', 'EMBEDDING_NOT_CONFIGURED':'Embedding服务尚未配置，暂不能使用混合检索', 'INDEX_NOT_READY':'所选文件尚无当前版本的可用语义索引', 'INDEX_CHANGED':'语义索引或Embedding配置已变化，请重新预览', 'CONTEXT_BUDGET_EXCEEDED':'材料太长，当前一次最多处理约 100 页文字；请改用关键词或混合检索，或分段处理', 'INVALID_SELECTION':'选择的文件、片段或背景无效', 'QUERY_REQUIRED':'混合检索需要明确的本次问题或查询词', 'CONFIRMATION_REQUIRED':'请确认背景仅用于本次'}
        raise AuthError(code, messages.get(code, '请求无法处理，请检查后重试'), status) from None

def no_query(request, allowed=()):
    if set(request.query_params) - set(allowed):
        raise AuthError('INVALID_REQUEST','不支持此筛选或游标',422)

@router.post('')
async def create(body: CreateRequest, request: Request, actor: ActorContext=Depends(require_actor)):
    return envelope(request, await operation(service(request).create(actor, **body.model_dump())), status=201)

@router.get('')
async def list_retained(request: Request, limit: int=20, cursor: str | None=None, status: str | None=None, actor: ActorContext=Depends(require_actor)):
    no_query(request, ('limit','cursor','status'))
    return envelope(request, await operation(service(request).list_retained(actor, limit=limit,cursor=cursor,status=status)))

@router.get('/temporary')
async def temporary(request: Request, actor: ActorContext=Depends(require_actor)):
    no_query(request)
    return envelope(request, await operation(service(request).list_temporary(actor)))

@router.get('/{identifier}')
async def get(identifier: str, request: Request, actor: ActorContext=Depends(require_actor)):
    return envelope(request, await operation(service(request).get(actor, identifier)))

@router.patch('/{identifier}')
async def patch(identifier: str, body: PatchRequest, request: Request, actor: ActorContext=Depends(require_actor)):
    fields = body.model_dump(exclude_unset=True)
    revision = fields.pop('expected_revision')
    if any(v is None for v in fields.values()):
        raise AuthError('INVALID_REQUEST','字段不能为null',422)
    return envelope(request, await operation(service(request).patch(actor, identifier, revision, **fields)))

@router.put('/{identifier}/documents')
async def select_documents(identifier: str, body: DocumentsRequest, request: Request, actor: ActorContext=Depends(require_actor)):
    return envelope(request, await operation(service(request).select_documents(actor, identifier, body.expected_revision, body.document_version_ids)))

@router.get('/{identifier}/messages')
async def messages(identifier: str, request: Request, actor: ActorContext=Depends(require_actor)):
    no_query(request)
    from fileaction.runs.routes import service as run_service
    items = await operation(service(request).messages(actor, identifier))
    return envelope(request, await operation(visible_messages(items, run_service(request), actor)))

async def visible_messages(items, runs, actor):
    """Redis已写而PG未提交/取消的生成答案不能从消息接口提前公开。"""
    from fileaction.runs.errors import RunError
    visible=[]
    for message in items['items']:
        if message.get('role')=='assistant' and message.get('run_id'):
            try: await runs.result(actor,message['run_id'])
            except (RunError,TemporaryError,WorkspaceError): continue
        visible.append(message)
    return {**items,'items':visible}

@router.post('/{identifier}/facts')
async def add_fact(identifier: str, body: FactRequest, request: Request, actor: ActorContext=Depends(require_actor)):
    return envelope(request, await operation(service(request).fact(actor, identifier, **body.model_dump())))

@router.patch('/{identifier}/facts/{fact_id}')
async def edit_fact(identifier: str, fact_id: str, body: FactRequest, request: Request, actor: ActorContext=Depends(require_actor)):
    return envelope(request, await operation(service(request).fact(actor, identifier, fact_id=fact_id, **body.model_dump())))

@router.delete('/{identifier}/facts/{fact_id}')
async def delete_fact(identifier: str, fact_id: str, body: RevisionRequest, request: Request, actor: ActorContext=Depends(require_actor)):
    return envelope(request, await operation(service(request).fact(actor, identifier, fact_id=fact_id, delete=True, **body.model_dump())))

@router.post('/{identifier}/context-preview')
async def preview(identifier: str, body: PreviewRequest, request: Request, actor: ActorContext=Depends(require_actor)):
    return envelope(request, await operation(service(request).preview(actor, identifier, body)))

@router.post('/{identifier}/end')
async def end(identifier: str, body: RevisionRequest, request: Request, actor: ActorContext=Depends(require_actor)):
    return envelope(request, await operation(service(request).end(actor, identifier, body.expected_revision)))
