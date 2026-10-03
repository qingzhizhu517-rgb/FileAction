import asyncio
import json
from fastapi import APIRouter,Depends,Header,Request
from fastapi.responses import StreamingResponse
from pydantic import Field
from fileaction.auth.dependencies import require_actor
from fileaction.auth.routes import envelope
from fileaction.auth.service import AuthError
from fileaction.db.session import ActorContext
from fileaction.workspaces.dto import DTO
from fileaction.workspaces.routes import service as workspace_service,operation as workspace_operation
from .service import RunService,RunError
from .repository import RunRepository

router=APIRouter(prefix='/api/v1',tags=['runs'])
class RunRequest(DTO):
    preview_id: str=Field(min_length=1,max_length=160)
    manifest_hash: str=Field(min_length=64,max_length=64)
    expected_revision: int=Field(ge=1)
    consent_to_send: bool
    consent_to_embed_query: bool = False

def service(request):
    return RunService(workspace_service(request),RunRepository(request.app.state.database_sessions))

async def operation(task):
    try: return await workspace_operation(task)
    except RunError as exc:
        code=str(exc)
        status=404 if code=='RESOURCE_NOT_FOUND' else 401 if code=='SESSION_REVOKED' else 422 if code in {'CONSENT_REQUIRED','IDEMPOTENCY_KEY_REQUIRED'} else 409
        messages={'CONSENT_REQUIRED':'请先确认本次模型外发范围','EMBEDDING_CONSENT_REQUIRED':'请单独确认将查询发送给 Embedding 服务','IDEMPOTENCY_CONFLICT':'请求标识已用于另一项操作，请重新发起','WORKSPACE_BUSY':'当前工作区已有生成运行','ACCOUNT_RUN_LIMIT':'当前账号活动运行已达上限','RESULT_NOT_AVAILABLE':'结果尚未就绪或已需重新核对','SESSION_REVOKED':'登录会话已失效，请重新登录'}
        raise AuthError(code,messages.get(code,'运行状态已变化，请刷新后重试'),status) from None

@router.post('/workspaces/{identifier}/runs')
async def create(identifier:str,body:RunRequest,request:Request,idempotency_key:str|None=Header(default=None),actor:ActorContext=Depends(require_actor)):
    return envelope(request,await operation(service(request).create(actor,identifier,idempotency_key,body.model_dump())),status=202)

@router.get('/runs/{identifier}')
async def get(identifier:str,request:Request,actor:ActorContext=Depends(require_actor)):
    return envelope(request,await operation(service(request).get(actor,identifier)))

@router.get('/runs/{identifier}/result')
async def result(identifier:str,request:Request,actor:ActorContext=Depends(require_actor)):
    return envelope(request,await operation(service(request).result(actor,identifier)))

@router.post('/runs/{identifier}/cancel')
async def cancel(identifier:str,request:Request,actor:ActorContext=Depends(require_actor)):
    return envelope(request,await operation(service(request).cancel(actor,identifier)))

@router.get('/runs/{identifier}/events')
async def events(identifier:str,request:Request,last_event_id:str|None=Header(default=None),actor:ActorContext=Depends(require_actor)):
    svc=service(request)
    await operation(svc.get(actor,identifier))
    try: after=int(last_event_id or 0)
    except ValueError: raise AuthError('INVALID_REQUEST','事件序号无效',422) from None
    if after<0: raise AuthError('INVALID_REQUEST','事件序号无效',422)
    async def stream():
        nonlocal after
        heartbeat=0
        while not await request.is_disconnected():
            try:
                status=await svc.get(actor,identifier)
                items=await svc.repository.events(actor,identifier,after)
            except (RunError,AuthError): return
            for item in items:
                after=item['seq']
                payload=dict(run_id=identifier,phase=item['phase'],occurred_at=item['occurred_at'].isoformat(),**item['safe_payload'])
                yield 'id: '+str(after)+'\nevent: '+item['type']+'\ndata: '+json.dumps(payload,ensure_ascii=False)+'\n\n'
            if status['status'] not in {'queued','running'}: return
            heartbeat+=1
            if heartbeat>=15:
                yield ': heartbeat\n\n'; heartbeat=0
            await asyncio.sleep(1)
    return StreamingResponse(stream(),media_type='text/event-stream',headers={'Cache-Control':'no-cache','X-Accel-Buffering':'no'})
