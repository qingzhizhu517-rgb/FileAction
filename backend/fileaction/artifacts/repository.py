"""长期成果版本适配器，组合owner约束与行锁保护不可变版本。"""
import hashlib
from datetime import datetime,timezone
from uuid import UUID,uuid4
from sqlalchemy import select,insert,update,delete,func
from fileaction.db.session import tenant_transaction
from fileaction.db.models import artifacts,artifact_versions,workspaces,answers,documents,document_versions,document_segments,runs,run_documents
from .service import ArtifactError

def uid(value):
    try: return UUID(str(value))
    except (ValueError,TypeError): raise ArtifactError('RESOURCE_NOT_FOUND') from None

def redact_deleted_fields(value,quotes,*,unverifiable=False):
    """已删除来源不能通过标题、未知项或用户确认导出重新出现。"""
    if unverifiable:
        return {**value,'title':'来源已删除的成果','body':'[来源已删除；无法再次核验原文范围，本版本正文不再提供导出]','unknowns':['来源已删除，原未知项不再提供。']}
    def clean(text):
        for quote in quotes:
            if quote: text=text.replace(quote,'[来源已删除]')
        return text
    return {**value,'title':clean(value['title']),'body':clean(value['body']),'unknowns':[clean(u) for u in value['unknowns']]}

class ArtifactRepository:
    def __init__(self,factory): self.factory=factory
    async def workspace_revision(self,actor,identifier):
        async with tenant_transaction(self.factory,actor) as db:
            value=await db.scalar(select(workspaces.c.revision).where(workspaces.c.id==uid(identifier),workspaces.c.owner_id==actor.user_id,workspaces.c.retained_at.is_not(None)))
            if value is None: raise ArtifactError('RESOURCE_NOT_FOUND')
            return value
    async def row(self,db,actor,identifier,lock=False):
        query=select(artifacts).join(workspaces,(artifacts.c.workspace_id==workspaces.c.id)&(artifacts.c.owner_id==workspaces.c.owner_id)).where(artifacts.c.id==uid(identifier),artifacts.c.owner_id==actor.user_id,workspaces.c.retained_at.is_not(None))
        if lock: query=query.with_for_update(of=artifacts)
        row=(await db.execute(query)).mappings().first()
        if not row: raise ArtifactError('RESOURCE_NOT_FOUND')
        return row
    async def view(self,db,actor,row,version=None):
        selected=(await db.execute(select(artifact_versions).where(artifact_versions.c.artifact_id==row['id'],artifact_versions.c.owner_id==actor.user_id,artifact_versions.c.version==(version or row['current_version']),artifact_versions.c.redacted_at.is_(None)))).mappings().first()
        if not selected: raise ArtifactError('RESOURCE_NOT_FOUND')
        sources=[]; unknowns=[]; validity=selected['validity']; body=selected['body']; removed=[]; unavailable=False
        generated_at=None
        if selected['run_id']:
            run=(await db.execute(select(runs).where(runs.c.id==selected['run_id'],runs.c.owner_id==actor.user_id))).mappings().first()
            answer=(await db.execute(select(answers).where(answers.c.run_id==selected['run_id'],answers.c.owner_id==actor.user_id,answers.c.workspace_id==row['workspace_id']))).mappings().first()
            if not run or run['status']!='succeeded' or not answer: raise ArtifactError('RESOURCE_NOT_FOUND')
            if answer['redacted_at'] is not None or not answer['envelope_json']: raise ArtifactError('RESOURCE_NOT_FOUND')
            generated_at=answer['generated_at']
            validity=answer['validity'] if answer['validity']!='current' else validity
            unknowns=answer['envelope_json'].get('unknowns',[])
            dependencies=(await db.execute(select(run_documents.c.document_version_id,document_versions.c.document_id,document_versions.c.redacted_at,documents.c.deletion_state).outerjoin(document_versions,(run_documents.c.document_version_id==document_versions.c.id)&(run_documents.c.owner_id==document_versions.c.owner_id)).outerjoin(documents,(documents.c.id==document_versions.c.document_id)&(documents.c.owner_id==document_versions.c.owner_id)).where(run_documents.c.run_id==selected['run_id'],run_documents.c.owner_id==actor.user_id))).mappings().all()
            for dependency in dependencies:
                if dependency['deletion_state']!='active' or dependency['redacted_at'] is not None:
                    validity='source_deleted'; unavailable=True
                    sources.append(dict(type='document',version=str(dependency['document_version_id']),state='source_deleted'))
            envelope=answer['envelope_json']
            for claim in [*envelope.get('claims',[]),*envelope.get('action_candidates',[]),*envelope.get('memory_candidates',[])]:
                for reference in claim.get('evidence',[]):
                    ref=dict(reference)
                    if ref['type']=='document':
                        segment=await db.scalar(select(document_segments.c.text).join(document_versions,(document_segments.c.document_version_id==document_versions.c.id)&(document_segments.c.owner_id==document_versions.c.owner_id)).join(documents,(documents.c.id==document_versions.c.document_id)&(documents.c.owner_id==document_versions.c.owner_id)).where(documents.c.owner_id==actor.user_id,documents.c.id==uid(ref['document_id']),documents.c.deletion_state=='active',document_versions.c.id==uid(ref['version']),document_versions.c.redacted_at.is_(None),document_segments.c.id==uid(ref['segment_id'])))
                        if not segment or ref['quote'] not in segment:
                            removed.append(ref['quote']); validity='source_deleted'
                            ref={k:v for k,v in ref.items() if k not in {'quote','location','char_start','char_end'}}; ref['state']='source_deleted'
                        else: ref['state']='verified'
                    else: ref['state']='stale'; validity='stale' if validity=='current' else validity
                    if ref not in sources: sources.append(ref)
        def serialize(value): return str(value) if isinstance(value,UUID) else value.isoformat() if isinstance(value,datetime) else value
        result={k:serialize(v) for k,v in row.items() if k!='owner_id'}
        result.update({k:serialize(v) for k,v in selected.items() if k not in {'id','owner_id','artifact_id','created_at'}})
        fields=redact_deleted_fields(dict(title=row['title'],body=body,unknowns=unknowns),removed,unverifiable=unavailable)
        if unavailable: sources=[{k:v for k,v in source.items() if k not in {'quote','location','char_start','char_end'}} for source in sources]
        return {**result,**fields,'generated_at':serialize(generated_at),'validity':validity,'retention':'retained','historical':selected['version']!=row['current_version'],'sources':sources,'verification_note':'用户编辑内容未经自动核验' if selected['author_kind']=='user' else '模型原稿，请核对后使用'}
    async def list(self,actor,workspace_id=None):
        async with tenant_transaction(self.factory,actor) as db:
            query=select(artifacts.c.id).join(workspaces,(artifacts.c.workspace_id==workspaces.c.id)&(artifacts.c.owner_id==workspaces.c.owner_id)).where(artifacts.c.owner_id==actor.user_id,workspaces.c.retained_at.is_not(None))
            if workspace_id:
                found=await db.scalar(select(workspaces.c.id).where(workspaces.c.id==uid(workspace_id),workspaces.c.owner_id==actor.user_id,workspaces.c.retained_at.is_not(None)))
                if not found: raise ArtifactError('RESOURCE_NOT_FOUND')
                query=query.where(artifacts.c.workspace_id==uid(workspace_id))
            output=[]
            for identifier in (await db.execute(query.order_by(artifacts.c.created_at,artifacts.c.id))).scalars():
                try: output.append(await self.view(db,actor,await self.row(db,actor,identifier)))
                except ArtifactError: continue
            return output
    async def get(self,actor,identifier,version=None):
        async with tenant_transaction(self.factory,actor) as db: return await self.view(db,actor,await self.row(db,actor,identifier),version)
    async def versions(self,actor,identifier):
        async with tenant_transaction(self.factory,actor) as db:
            row=await self.row(db,actor,identifier)
            return dict(items=[await self.view(db,actor,row,i) for i in range(1,row['current_version']+1)],next_cursor=None)
    async def patch(self,actor,identifier,expected_revision,body):
        async with tenant_transaction(self.factory,actor) as db:
            row=await self.row(db,actor,identifier,True)
            if row['revision']!=expected_revision: raise ArtifactError('REVISION_CONFLICT')
            previous=await self.view(db,actor,row); version=row['current_version']+1
            await db.execute(insert(artifact_versions).values(id=uuid4(),owner_id=actor.user_id,artifact_id=row['id'],version=version,body=body,body_hash=hashlib.sha256(body.encode()).hexdigest(),author_kind='user',run_id=uid(previous['run_id']) if previous['run_id'] else None,validity=previous['validity'],edited_at=datetime.now(timezone.utc)))
            await db.execute(update(artifacts).where(artifacts.c.id==row['id'],artifacts.c.owner_id==actor.user_id).values(current_version=version,revision=expected_revision+1,updated_at=func.now()))
            return await self.view(db,actor,await self.row(db,actor,identifier))
    async def delete(self,actor,identifier,expected_revision):
        async with tenant_transaction(self.factory,actor) as db:
            row=await self.row(db,actor,identifier,True)
            if row['revision']!=expected_revision: raise ArtifactError('REVISION_CONFLICT')
            await db.execute(delete(artifact_versions).where(artifact_versions.c.artifact_id==row['id'],artifact_versions.c.owner_id==actor.user_id))
            await db.execute(delete(artifacts).where(artifacts.c.id==row['id'],artifacts.c.owner_id==actor.user_id))
        return dict(id=identifier,deleted=True)
