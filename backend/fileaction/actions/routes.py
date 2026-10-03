from fastapi import APIRouter,Depends,Header,Request
from fileaction.auth.dependencies import require_actor
from fileaction.auth.routes import envelope
from fileaction.auth.service import AuthError
from fileaction.db.session import ActorContext
from fileaction.runs.routes import service as runs_service,operation as run_operation
from fileaction.workspaces.routes import no_query
from .service import ActionService,ActionError
from .repository import ActionRepository
from .dto import CreateAction,PatchAction,DeleteAction

router=APIRouter(prefix='/api/v1',tags=['actions'])
def service(request): return ActionService(runs_service(request),ActionRepository(request.app.state.database_sessions))
async def operation(task):
    try: return await run_operation(task)
    except ActionError as exc:
        code=str(exc)
        status=404 if code=='RESOURCE_NOT_FOUND' else 409 if code in {'REVISION_CONFLICT','IDEMPOTENCY_CONFLICT','RESULT_NOT_AVAILABLE','WORKSPACE_ENDING'} else 422
        messages={'CONFIRMATION_REQUIRED':'请明确确认创建或删除行动','PROPOSAL_NOT_SHOWN':'请先查看当前模型建议再确认','REVISION_CONFLICT':'行动已更新，请刷新后重试','INVALID_REQUEST':'行动字段无效；截止时间必须包含时区','RESOURCE_NOT_FOUND':'行动或工作区不存在','RESULT_NOT_AVAILABLE':'建议来源已经变化，请重新解读'}
        raise AuthError(code,messages.get(code,'请求无法处理，请刷新后重试'),status) from None

@router.get('/actions')
async def list_actions(request:Request,workspace_id:str|None=None,status:str|None=None,actor:ActorContext=Depends(require_actor)):
    no_query(request,('workspace_id','status'))
    return envelope(request,await operation(service(request).list(actor,workspace_id,status)))

@router.post('/actions')
async def create(body:CreateAction,request:Request,idempotency_key:str|None=Header(default=None),actor:ActorContext=Depends(require_actor)):
    return envelope(request,await operation(service(request).create(actor,idempotency_key,body.model_dump(exclude_unset=True))),status=201)

@router.get('/actions/{identifier}')
async def get(identifier:str,request:Request,actor:ActorContext=Depends(require_actor)):
    return envelope(request,await operation(service(request).get(actor,identifier)))

@router.patch('/actions/{identifier}')
async def patch(identifier:str,body:PatchAction,request:Request,actor:ActorContext=Depends(require_actor)):
    values=body.model_dump(exclude_unset=True); revision=values.pop('expected_revision')
    return envelope(request,await operation(service(request).patch(actor,identifier,revision,**values)))

@router.delete('/actions/{identifier}')
async def delete(identifier:str,body:DeleteAction,request:Request,actor:ActorContext=Depends(require_actor)):
    return envelope(request,await operation(service(request).delete(actor,identifier,body.expected_revision,body.confirmed)))

@router.get('/workspaces/{identifier}/action-proposals')
async def proposals(identifier:str,run_id:str,request:Request,actor:ActorContext=Depends(require_actor)):
    no_query(request,('run_id',))
    return envelope(request,await operation(service(request).proposals(actor,identifier,run_id)))
