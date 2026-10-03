"""所有当前模型成果先经RunService.result核验；历史显式降级。"""
import copy
import hashlib
import io
import re
import zipfile
from datetime import datetime, timezone
from fileaction.workspaces.service import WorkspaceError, session_mutation, content_hash
from fileaction.runs.errors import RunError
from fileaction.storage_adapters.temporary import TemporaryError
from fileaction.documents.service import DocumentError

class ArtifactError(ValueError):
    pass

def safe_filename(title,suffix='.md'):
    clean=''.join('_' if ord(c)<32 or ord(c)==127 or c in '/\\:*?"<>|' else c for c in title)
    clean=clean.strip(' .')[:100].rstrip(' .') or '成果'
    if clean.split('.')[0].upper() in {'CON','PRN','AUX','NUL',*[f'COM{i}' for i in range(1,10)],*[f'LPT{i}' for i in range(1,10)]}: clean='_'+clean
    return clean+suffix

class ArtifactService:
    def __init__(self,runs,repository=None):
        self.runs=runs; self.workspaces=runs.workspaces; self.temporary=self.workspaces.temporary; self.repository=repository

    async def _locate(self,actor,identifier):
        for ws in await self.temporary.list(actor,'workspace'):
            if ws.value['status'] not in {'active','paused'}: continue
            for item in ws.value.get('artifacts',[]):
                if item['id']==identifier: return ws,item
        raise ArtifactError('RESOURCE_NOT_FOUND')

    @staticmethod
    def _versions(item):
        return item.get('versions') or [{k:v for k,v in item.items() if k not in {'versions','revision','current_version'}}]

    async def _verified(self,actor,ws,item):
        try:
            result=await self.runs.result(actor,item['run_id'])
            validity='current'
        except RunError as exc:
            if str(exc)!='RESULT_NOT_AVAILABLE': raise ArtifactError('RESOURCE_NOT_FOUND') from None
            row,_=await self.runs.repository.get(actor,item['run_id'])
            if row['status']!='succeeded': raise ArtifactError('RESOURCE_NOT_FOUND')
            content=await self.runs.content.get(actor,item['run_id'])
            result=content.value.get('result'); marker=content.value.get('commit')
            if not result or not marker or marker['hash']!=content_hash(result) or ws.value.get('answers',{}).get(item['run_id'])!=result:
                raise ArtifactError('RESOURCE_NOT_FOUND')
            validity='stale'
        if result['workspace_id']!=ws.id: raise ArtifactError('RESOURCE_NOT_FOUND')
        original=self._versions(item)[0]; model=result['envelope'].get('artifact')
        if not model or any(original.get(k)!=model.get(k) for k in ('title','kind','body')): raise ArtifactError('RESOURCE_NOT_FOUND')
        sources=[]; removed=[]
        content=await self.runs.content.get(actor,item['run_id'])
        for frozen in content.value['manifest']['documents']:
            try:
                doc=await self.workspaces.documents._value(actor,frozen['document_id'])
                available=doc['parse_status']=='ready' and doc['current_version_id']==frozen['document_version_id']
            except DocumentError: available=False
            if not available:
                validity='source_deleted'
                removed.extend(part['text'] for part in frozen['segments'])
                sources.append(dict(type='document',document_id=frozen['document_id'],version=frozen['document_version_id'],state='source_deleted'))
        for claim in [*result['envelope']['claims'],*result['envelope']['action_candidates'],*result['envelope']['memory_candidates']]:
            for evidence in claim['evidence']:
                ref=copy.deepcopy(evidence)
                if ref['type']=='document':
                    try:
                        doc=await self.workspaces.documents._value(actor,ref['document_id'])
                        segment=next((s for s in doc['segments'] if s['id']==ref['segment_id']),None)
                        valid=doc['current_version_id']==ref['version'] and segment and ref['quote'] in segment['text']
                    except DocumentError: valid=False
                    if not valid:
                        removed.append(ref['quote']); ref={k:v for k,v in ref.items() if k not in {'quote','location','char_start','char_end'}}
                        ref['state']='source_deleted'; validity='source_deleted'
                    else: ref['state']='verified'
                else:
                    fact=next((f for f in ws.value['facts'] if f['id']==ref['fact_id'] and f['version']==ref['version']),None)
                    ref['state']='verified' if fact else 'stale'
                if ref not in sources: sources.append(ref)
        return validity,sources,result['envelope']['unknowns'],removed

    async def _view(self,actor,ws,item,version=None):
        validity,sources,unknowns,removed=await self._verified(actor,ws,item)
        versions=self._versions(item); current=item.get('current_version',versions[-1]['version'])
        chosen=next((v for v in versions if v['version']==(version or current)),None)
        if not chosen: raise ArtifactError('RESOURCE_NOT_FOUND')
        body=chosen['body']
        title=chosen['title']
        for quote in removed:
            body=body.replace(quote,'[来源已删除]');title=title.replace(quote,'[来源已删除]')
            unknowns=[u.replace(quote,'[来源已删除]') for u in unknowns]
        return {**chosen,'id':item['id'],'title':title,'workspace_id':ws.id,'revision':item.get('revision',1),'current_version':current,'historical':chosen['version']!=current,'retention':'temporary','body':body,'validity':validity,'sources':sources,'unknowns':unknowns,'verification_note':'用户编辑内容未经自动核验' if chosen['author_kind']=='user' else '模型原稿，请核对后使用'}

    async def list(self,actor,workspace_id=None):
        output=[]
        if workspace_id:
            try: resources=[await self.workspaces._resource(actor,workspace_id)]
            except WorkspaceError as exc:
                if str(exc)!='RESOURCE_NOT_FOUND': raise ArtifactError(str(exc)) from None
                if self.repository: return dict(items=await self.repository.list(actor,workspace_id),next_cursor=None)
                raise ArtifactError('RESOURCE_NOT_FOUND') from None
        else: resources=await self.temporary.list(actor,'workspace')
        for ws in resources:
            if ws.value['status'] not in {'active','paused'}: continue
            for item in ws.value.get('artifacts',[]):
                try: output.append(await self._view(actor,ws,item))
                except (ArtifactError,RunError,TemporaryError): continue
        if self.repository and not workspace_id: output.extend(await self.repository.list(actor))
        return dict(items=output,next_cursor=None)

    async def get(self,actor,identifier,version=None):
        try: ws,item=await self._locate(actor,identifier)
        except ArtifactError:
            if self.repository: return await self.repository.get(actor,identifier,version)
            raise
        return await self._view(actor,ws,item,version)

    async def versions(self,actor,identifier):
        try: ws,item=await self._locate(actor,identifier)
        except ArtifactError:
            if self.repository: return await self.repository.versions(actor,identifier)
            raise
        return dict(items=[await self._view(actor,ws,item,v['version']) for v in self._versions(item)],next_cursor=None)

    @session_mutation
    async def patch(self,actor,identifier,expected_revision,body):
        if not isinstance(body,str) or not body.strip() or len(body)>30000: raise ArtifactError('INVALID_REQUEST')
        try: ws,item=await self._locate(actor,identifier)
        except ArtifactError:
            if self.repository: return await self.repository.patch(actor,identifier,expected_revision,body)
            raise
        view=await self._view(actor,ws,item)
        if view['revision']!=expected_revision: raise ArtifactError('REVISION_CONFLICT')
        previous=self._versions(item); version=view['current_version']+1
        next_version={**previous[-1],'body':body,'version':version,'author_kind':'user','edited_at':datetime.now(timezone.utc).isoformat(),'body_hash':hashlib.sha256(body.encode()).hexdigest()}
        updated={**item,'revision':expected_revision+1,'current_version':version,'versions':[*previous,next_version]}
        await self.workspaces._save(actor,ws,{**ws.value,'artifacts':[updated if a['id']==identifier else a for a in ws.value['artifacts']]},change=False)
        return await self.get(actor,identifier)

    @session_mutation
    async def delete(self,actor,identifier,expected_revision,confirmed):
        if confirmed is not True: raise ArtifactError('CONFIRMATION_REQUIRED')
        try: ws,item=await self._locate(actor,identifier)
        except ArtifactError:
            if self.repository: return await self.repository.delete(actor,identifier,expected_revision)
            raise
        if item.get('revision',1)!=expected_revision: raise ArtifactError('REVISION_CONFLICT')
        await self.workspaces._save(actor,ws,{**ws.value,'artifacts':[a for a in ws.value['artifacts'] if a['id']!=identifier]},change=False)
        return dict(id=identifier,deleted=True)

    @staticmethod
    def _markdown(view,confirm_historical=False,confirm_stale=False):
        if view['historical'] and not confirm_historical: raise ArtifactError('HISTORICAL_CONFIRMATION_REQUIRED')
        if view['validity']!='current' and not confirm_stale: raise ArtifactError('STALE_CONFIRMATION_REQUIRED')
        lines=[view['body'],'','---',f"版本：{view['version']} · {'历史版本' if view['historical'] else '当前版本'} · {'用户编辑' if view['author_kind']=='user' else '模型原稿'} · {view['validity']}",f"原生成时间：{view.get('generated_at') or '未提供（无模型生成记录）'}",f"用户编辑时间：{view.get('edited_at') or '无'}",view['verification_note'],'','## 来源与未知范围']
        for source in view['sources']:
            if source['state']=='verified':
                lines.append('- '+(source.get('quote') or '已确认背景')+'（'+source.get('document_id',source.get('fact_id',''))+'）')
            else: lines.append('- 来源已变化或删除；原引用不可用。')
        lines.extend('- '+u for u in view['unknowns'])
        if not view['unknowns']: lines.append('- 模型未列出其他未知项，不代表内容已经核验。')
        lines.append('- 此文件仅为准备材料，不代表已报名、资格通过或完成外部动作。')
        return ('\n'.join(lines)+'\n').encode('utf-8')

    @session_mutation
    async def export(self,actor,identifier,version,expected_revision,*,confirm_historical=False,confirm_stale=False):
        view=await self.get(actor,identifier,version)
        if view['revision']!=expected_revision: raise ArtifactError('REVISION_CONFLICT')
        return dict(content=self._markdown(view,confirm_historical,confirm_stale),filename=safe_filename(view['title']),media_type='text/markdown; charset=utf-8')

    @session_mutation
    async def export_workspace(self,actor,workspace_id,expected_revision,selections,*,confirm_historical=False,confirm_stale=False):
        try: workspace=await self.workspaces._resource(actor,workspace_id); revision=workspace.value['revision']
        except WorkspaceError as exc:
            if str(exc)!='RESOURCE_NOT_FOUND' or not self.repository: raise ArtifactError(str(exc)) from None
            revision=await self.repository.workspace_revision(actor,workspace_id)
        if revision!=expected_revision: raise ArtifactError('REVISION_CONFLICT')
        if not selections or len(selections)>50 or len({(s['artifact_id'],s['version']) for s in selections})!=len(selections): raise ArtifactError('INVALID_SELECTION')
        output=io.BytesIO(); names=set()
        with zipfile.ZipFile(output,'w',compression=zipfile.ZIP_DEFLATED) as archive:
            for selected in selections:
                view=await self.get(actor,selected['artifact_id'],selected['version'])
                if view['workspace_id']!=workspace_id: raise ArtifactError('RESOURCE_NOT_FOUND')
                name=safe_filename(view['title'],f"-v{view['version']}.md"); index=2
                while name.casefold() in names:
                    name=safe_filename(view['title'],f"-v{view['version']}-{index}.md"); index+=1
                names.add(name.casefold())
                archive.writestr(name,self._markdown(view,confirm_historical,confirm_stale))
        return dict(content=output.getvalue(),filename='成果包.zip',media_type='application/zip')
