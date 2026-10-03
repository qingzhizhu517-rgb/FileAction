"""已保留行动适配器。复制保存批次由后续独立事务负责。"""
from datetime import datetime,timezone
from uuid import UUID,uuid5
from sqlalchemy import select,insert,update,delete,func,text
from fileaction.db.session import tenant_transaction
from fileaction.db.models import actions,action_sources,workspaces,consents
from fileaction.workspaces.service import content_hash
from .service import ActionError,validate_fields

def uid(value):
    try: return UUID(str(value))
    except (ValueError,TypeError): raise ActionError('RESOURCE_NOT_FOUND') from None

def public(row):
    item={k:(str(v) if isinstance(v,UUID) else v.isoformat() if isinstance(v,datetime) else v) for k,v in row.items() if k!='owner_id'}
    return {**item,'retention':'retained','origin_kind':'user_confirmed_proposal' if row['proposal_key'] else 'user_created'}

class ActionRepository:
    def __init__(self,factory): self.factory=factory
    def statement(self,actor):
        return select(actions).join(workspaces,(actions.c.workspace_id==workspaces.c.id)&(actions.c.owner_id==workspaces.c.owner_id)).where(actions.c.owner_id==actor.user_id,workspaces.c.retained_at.is_not(None))
    async def row(self,db,actor,identifier,lock=False):
        query=self.statement(actor).where(actions.c.id==uid(identifier))
        if lock: query=query.with_for_update(of=actions)
        row=(await db.execute(query)).mappings().first()
        if row is None: raise ActionError('RESOURCE_NOT_FOUND')
        return row
    async def list(self,actor,workspace_id=None,status=None):
        query=self.statement(actor)
        if workspace_id: query=query.where(actions.c.workspace_id==uid(workspace_id))
        if status: query=query.where(actions.c.status==status)
        async with tenant_transaction(self.factory,actor) as db:
            return [public(r) for r in (await db.execute(query.order_by(actions.c.created_at,actions.c.id))).mappings()]
    async def get(self,actor,identifier):
        async with tenant_transaction(self.factory,actor) as db: return public(await self.row(db,actor,identifier))
    async def create(self,actor,key,body):
        if body.get('proposal_id'): raise ActionError('PROPOSAL_NOT_SHOWN')
        identifier=uuid5(actor.user_id,'action:'+key); fingerprint=content_hash(body)
        fields=validate_fields({k:v for k,v in body.items() if k in {'title','description','priority','due_at'}})
        if fields.get('due_at'): fields['due_at']=datetime.fromisoformat(fields['due_at'])
        async with tenant_transaction(self.factory,actor) as db:
            await db.execute(text("SELECT pg_advisory_xact_lock(hashtextextended(:key,0))"),dict(key='action:'+str(identifier)))
            existing=(await db.execute(select(consents).where(consents.c.id==identifier,consents.c.owner_id==actor.user_id))).mappings().first()
            if existing:
                if existing['manifest_hash']!=fingerprint: raise ActionError('IDEMPOTENCY_CONFLICT')
                return public(await self.row(db,actor,identifier))
            workspace=await db.scalar(select(workspaces.c.id).where(workspaces.c.id==uid(body['workspace_id']),workspaces.c.owner_id==actor.user_id,workspaces.c.retained_at.is_not(None)))
            if not workspace: raise ActionError('RESOURCE_NOT_FOUND')
            await db.execute(insert(actions).values(id=identifier,owner_id=actor.user_id,workspace_id=workspace,status='confirmed',confirmed_at=datetime.now(timezone.utc),**{'priority':'normal',**fields}))
            await db.execute(insert(consents).values(id=identifier,owner_id=actor.user_id,operation='action_create',manifest_hash=fingerprint,retention_mode='retained',confirmed_at=datetime.now(timezone.utc)))
            return public(await self.row(db,actor,identifier))
    async def patch(self,actor,identifier,expected_revision,fields):
        if fields.get('due_at'): fields={**fields,'due_at':datetime.fromisoformat(fields['due_at'])}
        async with tenant_transaction(self.factory,actor) as db:
            row=await self.row(db,actor,identifier,True)
            if row['revision']!=expected_revision: raise ActionError('REVISION_CONFLICT')
            await db.execute(update(actions).where(actions.c.id==row['id'],actions.c.owner_id==actor.user_id).values(**fields,revision=expected_revision+1,updated_at=func.now()))
            return public(await self.row(db,actor,identifier))
    async def delete(self,actor,identifier,expected_revision):
        async with tenant_transaction(self.factory,actor) as db:
            row=await self.row(db,actor,identifier,True)
            if row['revision']!=expected_revision: raise ActionError('REVISION_CONFLICT')
            await db.execute(delete(action_sources).where(action_sources.c.action_id==row['id'],action_sources.c.owner_id==actor.user_id))
            await db.execute(delete(actions).where(actions.c.id==row['id'],actions.c.owner_id==actor.user_id))
        return dict(id=identifier,deleted=True)
