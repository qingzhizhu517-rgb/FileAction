"""临时工作区与冻结外发清单。预览及确认均不调用模型。"""
from __future__ import annotations
import asyncio
from functools import wraps
import hashlib
import json
from datetime import datetime, timezone
from uuid import UUID, uuid4
from urllib.parse import urlsplit
from fileaction.storage_adapters.temporary import TemporaryStore, TemporaryError
from fileaction.documents.service import DocumentError
from .dto import PreviewRequest

class WorkspaceError(ValueError):
    pass

def content_hash(value):
    return hashlib.sha256(json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(',', ':'), allow_nan=False).encode()).hexdigest()

def session_mutation(method):
    """Serialize attachment and cleanup; bounded work expires before its lease."""
    @wraps(method)
    async def guarded(self, actor, *args, **kwargs):
        key = f'workspace-mutation:{actor.user_id}:{actor.session_id}'
        async with self.temporary.redis.lock(key, timeout=30, blocking_timeout=2):
            try:
                async with asyncio.timeout(20):
                    return await method(self, actor, *args, **kwargs)
            except TimeoutError:
                raise WorkspaceError('DEPENDENCY_UNAVAILABLE') from None
    return guarded

class WorkspaceService:
    PROMPT_VERSION = 'fileaction-context-v1'

    def __init__(self, temporary, documents, settings, repository=None, *, retrieval=None):
        self.temporary, self.documents, self.settings, self.repository = temporary, documents, settings, repository
        self.retrieval = retrieval
        self.previews = temporary

    async def _resource(self, actor, identifier, *, allow_ending=False):
        try:
            resource = await self.temporary.get(actor, 'workspace', identifier)
        except TemporaryError as exc:
            if str(exc) in {'TEMPORARY_CONTENT_EXPIRED', 'RESOURCE_NOT_FOUND'}:
                raise WorkspaceError('RESOURCE_NOT_FOUND') from None
            raise
        if resource.value['status'] == 'ended':
            raise WorkspaceError('RESOURCE_NOT_FOUND')
        if resource.value['status'] == 'ending' and not allow_ending:
            raise WorkspaceError('WORKSPACE_ENDING')
        return resource

    @staticmethod
    def public(resource):
        return {k:v for k,v in resource.value.items() if k not in {'messages', 'temporary_document_ids', 'cleanup_document_versions', 'answers', 'artifacts', 'active_run', 'cancel_epoch', 'actions', 'action_requests', 'shown_proposals', 'deleted_action_proposals'}}

    @staticmethod
    def check(resource, revision):
        if resource.value['revision'] != revision:
            raise WorkspaceError('REVISION_CONFLICT')

    @session_mutation
    async def create(self, actor, *, title=None, primary_document_id=None, retention='temporary'):
        if retention != 'temporary':
            raise WorkspaceError('RETENTION_INVALID')
        documents = []
        if primary_document_id:
            documents.append(await self.documents.get(actor, primary_document_id))
        identifier = str(uuid4())
        value = dict(id=identifier, title=title or (documents[0]['name'] if documents else '未命名工作区'), goal='', status='active', retention='temporary', revision=1, documents=documents, facts=[], messages=[], temporary_document_ids=[d['id'] for d in documents if d['retention'] == 'temporary'])
        return self.public(await self.temporary.create(actor, 'workspace', value, resource_id=identifier))

    async def get(self, actor, identifier):
        return self.public(await self._resource(actor, identifier, allow_ending=True))

    async def list_temporary(self, actor):
        return {'items': [self.public(r) for r in await self.temporary.list(actor, 'workspace') if r.value['status'] != 'ended'], 'next_cursor': None}

    async def list_retained(self, actor, **kwargs):
        if self.repository is None:
            raise WorkspaceError('DEPENDENCY_UNAVAILABLE')
        return await self.repository.list(actor, **kwargs)

    async def _save(self, actor, resource, value, *, change=True):
        value['revision'] = resource.value['revision'] + int(change)
        try:
            saved = await self.temporary.replace(actor, 'workspace', resource.id, value, expected_revision=resource.revision)
        except TemporaryError as exc:
            if str(exc) == 'REVISION_CONFLICT':
                raise WorkspaceError('REVISION_CONFLICT') from None
            raise
        return self.public(saved)

    async def patch(self, actor, identifier, expected_revision, **fields):
        resource = await self._resource(actor, identifier)
        self.check(resource, expected_revision)
        if set(fields) - {'title', 'goal', 'status'} or fields.get('status', 'active') not in {'active', 'paused'}:
            raise WorkspaceError('INVALID_REQUEST')
        value = {**resource.value, **fields}
        return await self._save(actor, resource, value)

    async def _version(self, actor, version):
        for resource in await self.temporary.list(actor, 'document'):
            if resource.value['current_version_id'] == version:
                return await self.documents.get(actor, resource.id)
        if self.repository:
            identifier = await self.repository.document_id(actor, version)
            if identifier:
                doc = await self.documents.get(actor, identifier)
                if doc['current_version_id'] == version:
                    return doc
        raise WorkspaceError('RESOURCE_NOT_FOUND')

    @session_mutation
    async def select_documents(self, actor, identifier, expected_revision, versions):
        resource = await self._resource(actor, identifier)
        self.check(resource, expected_revision)
        if len(versions) > 20 or len(set(versions)) != len(versions):
            raise WorkspaceError('INVALID_SELECTION')
        docs = [await self._version(actor, v) for v in versions]
        return await self._save(actor, resource, {**resource.value, 'documents': docs, 'temporary_document_ids': sorted(set(resource.value.get('temporary_document_ids', [])) | {d['id'] for d in docs if d['retention'] == 'temporary'})})

    async def fact(self, actor, identifier, expected_revision, *, text=None, confirmed=False, fact_id=None, delete=False):
        resource = await self._resource(actor, identifier)
        self.check(resource, expected_revision)
        facts = [dict(f) for f in resource.value['facts']]
        previous = next((f for f in facts if f['id'] == fact_id), None)
        if fact_id and previous is None:
            raise WorkspaceError('RESOURCE_NOT_FOUND')
        if delete:
            facts.remove(previous)
        else:
            if not confirmed or not text or not text.strip():
                raise WorkspaceError('CONFIRMATION_REQUIRED')
            item = dict(id=fact_id or str(uuid4()), version=previous['version'] + 1 if previous else 1, text=text, confirmed=True, retention='temporary', origin_kind='user_confirmed')
            if previous:
                facts.remove(previous)
            facts.append(item)
        if len(facts) > 20 or sum(len(f['text']) for f in facts) > 8000:
            raise WorkspaceError('CONTEXT_BUDGET_EXCEEDED')
        return await self._save(actor, resource, {**resource.value, 'facts': facts})

    async def messages(self, actor, identifier):
        return {'items': (await self._resource(actor, identifier, allow_ending=True)).value['messages'], 'next_cursor': None}

    async def append_message(self, actor, identifier, *, role, text, expected_sequence):
        """内部写入合同；消息sequence独立于工作区领域revision。"""
        if role not in {'user', 'assistant', 'system'} or len(text) > 30000:
            raise WorkspaceError('INVALID_MESSAGE')
        resource = await self._resource(actor, identifier)
        messages = resource.value['messages']
        if expected_sequence != len(messages):
            raise WorkspaceError('MESSAGE_SEQUENCE_CONFLICT')
        message = dict(id=str(uuid4()), sequence=expected_sequence + 1, role=role, text=text)
        await self._save(actor, resource, {**resource.value, 'messages': [*messages, message]}, change=False)
        return message

    async def _delete_if_present(self, actor, kind, identifier):
        try:
            await self.temporary.delete(actor, kind, identifier)
        except TemporaryError as exc:
            if str(exc) != 'TEMPORARY_CONTENT_EXPIRED':
                raise

    @session_mutation
    async def end(self, actor, identifier, expected_revision):
        resource = await self._resource(actor, identifier, allow_ending=True)
        self.check(resource, expected_revision)
        if resource.value['status'] != 'ending':
            # Revoke use before any cleanup. Failed cleanup stays discoverable;
            # retries must supply this new domain revision and cannot reactivate.
            await self._save(actor, resource, {**resource.value, 'status': 'ending'})
            resource = await self._resource(actor, identifier, allow_ending=True)
        other_workspaces = await self.temporary.list(actor, 'workspace')
        referenced = {d['id'] for w in other_workspaces if w.id != identifier and w.value['status'] in {'active', 'paused'} for d in w.value['documents']}
        orphan_ids = set(resource.value.get('temporary_document_ids', [])) - referenced
        cleanup_versions = dict(resource.value.get('cleanup_document_versions', {}))
        for doc in await self.temporary.list(actor, 'document'):
            if doc.id in orphan_ids:
                cleanup_versions[doc.id] = doc.value['current_version_id']
        # Persist the exact version mapping before destroying originals: retries
        # after a lost delete response must still find version-only indexes.
        if cleanup_versions != resource.value.get('cleanup_document_versions', {}):
            await self._save(actor, resource, {**resource.value, 'cleanup_document_versions': cleanup_versions}, change=False)
        orphan_versions = {version for doc_id, version in cleanup_versions.items() if doc_id in orphan_ids}
        for doc_id in orphan_ids:
            await self._delete_if_present(actor, 'document', doc_id)
        for kind in ('preview', 'run', 'retention', 'index'):
            for dependent in await self.temporary.list(actor, kind):
                body = dependent.value
                same_workspace = body.get('workspace_id') == identifier or body.get('manifest', {}).get('workspace_id') == identifier
                orphan_index = kind == 'index' and (body.get('document_id') in orphan_ids or body.get('document_version_id') in orphan_versions)
                if same_workspace or orphan_index:
                    await self._delete_if_present(actor, kind, dependent.id)
        await self._delete_if_present(actor, 'workspace', identifier)
        return {'id': identifier, 'status': 'ended'}

    def model(self):
        return {'domain': urlsplit(self.settings.model_base_url or '').hostname, 'name': self.settings.model_name}

    def model_fingerprint(self):
        # Include endpoint path and credentials without exposing either in preview.
        return content_hash([self.settings.model_base_url, self.settings.model_name, self.settings.model_api_key, self.PROMPT_VERSION])

    async def now(self):
        seconds, micros = await self.temporary.redis.time()
        return seconds + micros / 1_000_000

    async def preview(self, actor, identifier, request: PreviewRequest):
        resource = await self._resource(actor, identifier)
        self.check(resource, request.expected_revision)
        value = resource.value
        linked = {d['current_version_id']: d for d in value['documents']}
        versions = request.document_version_ids if request.document_version_ids is not None else list(linked)
        if len(set(versions)) != len(versions) or any(v not in linked for v in versions):
            raise WorkspaceError('INVALID_SELECTION')
        selections = request.selections
        if selections is not None and any(s.document_version_id not in versions for s in selections):
            raise WorkspaceError('INVALID_SELECTION')
        frozen_documents = []
        complete = True
        for version in versions:
            original = await self.documents._value(actor, linked[version]['id'])
            if original['current_version_id'] != version or original['parse_status'] != 'ready':
                raise WorkspaceError('SOURCE_CHANGED')
            available = {s['id']:s for s in original['segments']}
            ranges = [s.model_dump() for s in selections if s.document_version_id == version] if selections is not None else [dict(segment_id=s['id'], char_start=0, char_end=len(s['text'])) for s in original['segments']]
            segments = []
            seen = set()
            for chosen in ranges:
                source = available.get(chosen['segment_id'])
                start, end = chosen['char_start'], chosen['char_end']
                key = (chosen['segment_id'], start, end)
                if not source or not 0 <= start < end <= len(source['text']) or key in seen:
                    raise WorkspaceError('INVALID_SELECTION')
                seen.add(key)
                excerpt = source['text'][start:end]
                if request.retrieval_mode == 'keyword':
                    query = request.query or request.message or value['goal']
                    if not query.strip():
                        raise WorkspaceError('QUERY_REQUIRED')
                    if query.casefold() not in excerpt.casefold():
                        continue
                segments.append(dict(segment_id=source['id'], char_start=start, char_end=end, text=excerpt, location=source['location'], content_hash=content_hash(excerpt)))
            full_ranges = {(s['id'], 0, len(s['text'])) for s in original['segments']}
            complete = complete and {(s['segment_id'],s['char_start'],s['char_end']) for s in segments} == full_ranges
            frozen_documents.append(dict(document_id=original['id'], document_version_id=version, name=original['name'], sha256=original['sha256'], segments=segments))
        def choose(items, ids):
            lookup = {i['id']:i for i in items}
            if len(set(ids)) != len(ids) or any(i not in lookup for i in ids):
                raise WorkspaceError('INVALID_SELECTION')
            return [lookup[i] for i in ids]
        facts = choose(value['facts'], request.fact_ids)
        history = choose(value['messages'], request.history_message_ids)
        counts = dict(documents=sum(len(s['text']) for d in frozen_documents for s in d['segments']), facts=sum(len(f['text']) for f in facts), history=sum(len(m['text']) for m in history), message=len(request.message), goal=len(value['goal']))
        # Conservative upper bound: each UTF-8 byte may be a token; include JSON metadata and policy reserve.
        payload = dict(documents=frozen_documents, facts=facts, history=history, message=request.message, goal=value['goal'])
        tokens = len(json.dumps(payload, ensure_ascii=False).encode()) + 2000
        if counts['documents'] > 1000000 or counts['facts'] > 32000 or counts['history'] > 48000 or counts['message'] > 12000 or tokens > 1000000:
            raise WorkspaceError('CONTEXT_BUDGET_EXCEEDED')
        manifest = dict(workspace_id=identifier, workspace_revision=value['revision'], **payload, kind=request.kind, retrieval_mode=request.retrieval_mode, query=request.query, model=self.model(), prompt_version=self.PROMPT_VERSION, retention='temporary', coverage='full_selected_text' if complete else 'selected_excerpts', character_counts=counts, estimated_tokens=tokens, embedding=None, index_versions=[], query_embedding_authorization=None)
        if request.retrieval_mode == 'hybrid':
            from .hybrid import configure
            await configure(self.retrieval, actor, manifest)
        manifest['content_hash'] = content_hash(payload)
        expires = await self.now() + 120
        snapshot = dict(manifest=manifest, manifest_hash=content_hash(manifest), model_fingerprint=self.model_fingerprint(), expires_at=expires)
        preview = await self.previews.create(actor, 'preview', snapshot)
        # Resource-only hard deadline: a short-lived store would shorten the
        # shared session registry and break cleanup/listing of other content.
        await self.temporary.redis.eval("if redis.call('EXISTS', KEYS[1]) == 1 then redis.call('HSET', KEYS[1], 'expires', ARGV[1]); redis.call('PEXPIREAT', KEYS[1], ARGV[2]); end; return 1", 1, self.temporary._key(actor, 'preview', preview.id), expires, int(expires * 1000))
        # Recheck domain revision after source reads to avoid presenting a mixed snapshot.
        self.check(await self._resource(actor, identifier), request.expected_revision)
        return dict(preview_id=preview.id, manifest_hash=snapshot['manifest_hash'], expires_at=datetime.fromtimestamp(expires, timezone.utc).isoformat(), manifest=manifest)

    async def validate_preview(self, actor, identifier, preview_id, manifest_hash, expected_revision):
        resource = await self._resource(actor, identifier)
        self.check(resource, expected_revision)
        try:
            preview = await self.previews.get(actor, 'preview', preview_id)
        except TemporaryError as exc:
            if str(exc) in {'TEMPORARY_CONTENT_EXPIRED', 'RESOURCE_NOT_FOUND'}:
                raise WorkspaceError('PREVIEW_EXPIRED') from None
            raise
        snapshot = preview.value
        manifest = snapshot['manifest']
        if await self.now() >= snapshot['expires_at']:
            raise WorkspaceError('PREVIEW_EXPIRED')
        if (manifest['workspace_id'] != identifier or manifest['workspace_revision'] != expected_revision or snapshot['model_fingerprint'] != self.model_fingerprint() or snapshot['manifest_hash'] != manifest_hash or content_hash(manifest) != manifest_hash):
            raise WorkspaceError('PREVIEW_STALE')
        for doc in manifest['documents']:
            try:
                current = await self.documents._value(actor, doc['document_id'])
            except DocumentError:
                raise WorkspaceError('SOURCE_CHANGED') from None
            if current['current_version_id'] != doc['document_version_id'] or current['sha256'] != doc['sha256'] or current['name'] != doc['name']:
                raise WorkspaceError('SOURCE_CHANGED')
            segments = {s['id']:s for s in current['segments']}
            for frozen in doc['segments']:
                segment = segments.get(frozen['segment_id'])
                if not segment or segment['text'][frozen['char_start']:frozen['char_end']] != frozen['text'] or content_hash(frozen['text']) != frozen['content_hash']:
                    raise WorkspaceError('SOURCE_CHANGED')
        from .hybrid import validate
        await validate(self.retrieval, actor, manifest)
        self.check(await self._resource(actor, identifier), expected_revision)
        return manifest
