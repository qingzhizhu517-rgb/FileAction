from urllib.parse import quote
from fastapi import APIRouter,Depends,Request,Query
from fastapi.responses import Response
from fileaction.auth.dependencies import require_actor
from fileaction.auth.routes import envelope
from fileaction.auth.service import AuthError
from fileaction.db.session import ActorContext
from fileaction.runs.routes import service as runs_service,operation as run_operation
from fileaction.workspaces.routes import no_query
from .service import ArtifactService,ArtifactError,safe_filename
from .repository import ArtifactRepository
from .dto import EditArtifact,DeleteArtifact,ExportArtifact,ExportWorkspace

router=APIRouter(prefix='/api/v1',tags=['artifacts'])
def service(request): return ArtifactService(runs_service(request),ArtifactRepository(request.app.state.database_sessions))
async def operation(task):
    try: return await run_operation(task)
    except ArtifactError as exc:
        code=str(exc); status=404 if code=='RESOURCE_NOT_FOUND' else 422 if code in {'INVALID_REQUEST','INVALID_SELECTION','CONFIRMATION_REQUIRED'} else 409
        messages={'RESOURCE_NOT_FOUND':'成果不存在或当前会话无权读取','REVISION_CONFLICT':'成果已更新，请刷新后重试','CONFIRMATION_REQUIRED':'请明确确认删除成果及版本','HISTORICAL_CONFIRMATION_REQUIRED':'所选为历史版本，请明确确认后导出','STALE_CONFIRMATION_REQUIRED':'来源或背景已变化，请明确确认过时内容后导出'}
        raise AuthError(code,messages.get(code,'请求无法处理，请刷新后重试'),status) from None

def download(payload):
    filename=safe_filename(payload['filename'],suffix='')
    return Response(content=payload['content'],media_type=payload['media_type'],headers={'Content-Disposition':"attachment; filename=download; filename*=UTF-8''"+quote(filename,safe=''),'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff'})

@router.get('/artifacts')
async def list_all(request:Request,actor:ActorContext=Depends(require_actor)):
    no_query(request)
    return envelope(request,await operation(service(request).list(actor)))

@router.get('/workspaces/{identifier}/artifacts')
async def list_workspace(identifier:str,request:Request,actor:ActorContext=Depends(require_actor)):
    no_query(request)
    return envelope(request,await operation(service(request).list(actor,identifier)))

@router.get('/artifacts/{identifier}')
async def get(identifier:str,request:Request,version:int|None=Query(default=None,ge=1),actor:ActorContext=Depends(require_actor)):
    no_query(request,('version',))
    return envelope(request,await operation(service(request).get(actor,identifier,version)))

@router.get('/artifacts/{identifier}/versions')
async def versions(identifier:str,request:Request,actor:ActorContext=Depends(require_actor)):
    no_query(request)
    return envelope(request,await operation(service(request).versions(actor,identifier)))

@router.patch('/artifacts/{identifier}')
async def patch(identifier:str,body:EditArtifact,request:Request,actor:ActorContext=Depends(require_actor)):
    return envelope(request,await operation(service(request).patch(actor,identifier,body.expected_revision,body.body)))

@router.delete('/artifacts/{identifier}')
async def delete(identifier:str,body:DeleteArtifact,request:Request,actor:ActorContext=Depends(require_actor)):
    return envelope(request,await operation(service(request).delete(actor,identifier,body.expected_revision,body.confirmed)))

@router.post('/artifacts/{identifier}/export')
async def export(identifier:str,body:ExportArtifact,request:Request,actor:ActorContext=Depends(require_actor)):
    return download(await operation(service(request).export(actor,identifier,**body.model_dump())))

@router.post('/workspaces/{identifier}/export')
async def export_workspace(identifier:str,body:ExportWorkspace,request:Request,actor:ActorContext=Depends(require_actor)):
    return download(await operation(service(request).export_workspace(actor,identifier,**body.model_dump())))
