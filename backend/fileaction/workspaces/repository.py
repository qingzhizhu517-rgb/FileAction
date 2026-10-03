"""RLS租户读取；临时工作区从不写入长期业务表。"""
import base64
import hashlib
import hmac
import json
from datetime import datetime
from uuid import UUID
from sqlalchemy import select, and_, or_
from fileaction.db.models import workspaces, documents, document_versions
from fileaction.db.session import tenant_transaction
from .service import WorkspaceError

class WorkspaceRepository:
    def __init__(self, factory, secret):
        self.factory, self.secret = factory, secret.encode()

    async def document_id(self, actor, version):
        try:
            identifier = UUID(version)
        except ValueError:
            raise WorkspaceError('RESOURCE_NOT_FOUND') from None
        async with tenant_transaction(self.factory, actor) as session:
            row = await session.scalar(select(documents.c.id).join(document_versions, and_(document_versions.c.document_id == documents.c.id, document_versions.c.owner_id == documents.c.owner_id, document_versions.c.version == documents.c.current_version)).where(documents.c.owner_id == actor.user_id, document_versions.c.id == identifier, documents.c.deletion_state == 'active', document_versions.c.redacted_at.is_(None)))
            return str(row) if row else None

    def encode(self, payload):
        raw = json.dumps(payload, sort_keys=True, separators=(',', ':')).encode()
        signature = hmac.new(self.secret, raw, hashlib.sha256).digest()
        return base64.urlsafe_b64encode(signature + raw).decode()

    def decode(self, token):
        try:
            raw = base64.b64decode(token, altchars=b'-_', validate=True)
            if not hmac.compare_digest(raw[:32], hmac.new(self.secret, raw[32:], hashlib.sha256).digest()):
                raise ValueError()
            return json.loads(raw[32:])
        except (ValueError, TypeError, UnicodeError):
            raise WorkspaceError('INVALID_CURSOR') from None

    async def list(self, actor, *, limit=20, cursor=None, status=None):
        if not 1 <= limit <= 100 or status not in {None, 'active', 'paused', 'ended'}:
            raise WorkspaceError('INVALID_REQUEST')
        statement = select(workspaces).where(workspaces.c.owner_id == actor.user_id, workspaces.c.retained_at.is_not(None))
        if status:
            statement = statement.where(workspaces.c.status == status)
        if cursor:
            payload = self.decode(cursor)
            if payload.get('owner') != str(actor.user_id) or payload.get('status') != status:
                raise WorkspaceError('INVALID_CURSOR')
            try:
                at, identifier = datetime.fromisoformat(payload['at']), UUID(payload['id'])
            except (ValueError, KeyError, TypeError):
                raise WorkspaceError('INVALID_CURSOR') from None
            statement = statement.where(or_(workspaces.c.updated_at < at, and_(workspaces.c.updated_at == at, workspaces.c.id < identifier)))
        async with tenant_transaction(self.factory, actor) as session:
            rows = (await session.execute(statement.order_by(workspaces.c.updated_at.desc(), workspaces.c.id.desc()).limit(limit + 1))).mappings().all()
        items = [{k: (str(v) if isinstance(v, UUID) else v.isoformat() if isinstance(v, datetime) else v) for k,v in row.items() if k != 'owner_id'} | {'retention':'retained'} for row in rows[:limit]]
        next_cursor = None
        if len(rows) > limit:
            last = rows[limit-1]
            next_cursor = self.encode(dict(owner=str(actor.user_id), status=status, at=last['updated_at'].isoformat(), id=str(last['id'])))
        return {'items':items,'next_cursor':next_cursor}
