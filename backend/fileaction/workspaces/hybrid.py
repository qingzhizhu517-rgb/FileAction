"""Hybrid 范围冻结与复核：只读本机存储，不调用 Embedding。"""
from urllib.parse import urlsplit
from fileaction.indexing.embedding import profile_hash
from .service import WorkspaceError, content_hash


def profile(provider):
    if provider is None or provider.indexing.profile is None:
        raise WorkspaceError('EMBEDDING_NOT_CONFIGURED')
    return provider.indexing.profile


async def freeze(provider, actor, documents):
    configured = profile(provider)
    current = await provider.active_indexes(actor, [d['document_id'] for d in documents])
    by_document = {item['document_id']: item for item in current}
    indexes = []
    for doc in documents:
        index = by_document.get(doc['document_id'])
        if not index or index['document_version_id'] != doc['document_version_id']:
            raise WorkspaceError('INDEX_NOT_READY')
        if index['profile_hash'] != profile_hash(configured):
            raise WorkspaceError('EMBEDDING_PROFILE_MISMATCH')
        ranges = doc['segments']
        chunks = [
            chunk for chunk in index['chunks']
            if chunk['spans'] and all(any(
                s['segment_id'] == span['segment_id'] and
                s['char_start'] <= span['start'] < span['end'] <= s['char_end']
                for s in ranges) for span in chunk['spans'])
        ]
        if not chunks:
            raise WorkspaceError('INDEX_SCOPE_EMPTY')
        indexes.append({**index, 'chunks': chunks})
    if not indexes:
        raise WorkspaceError('INDEX_NOT_READY')
    return indexes


async def configure(provider, actor, manifest):
    configured = profile(provider)
    query = (manifest['query'] or manifest['message'] or manifest['goal']).strip()
    if not query or len(query) > 200:
        raise WorkspaceError('QUERY_REQUIRED')
    manifest['query'] = query
    manifest['index_versions'] = await freeze(provider, actor, manifest['documents'])
    manifest['embedding'] = dict(
        domain=urlsplit(configured.base_url).hostname, model=configured.model,
        dimensions=configured.dimensions, profile_version=configured.version,
        profile_hash=profile_hash(configured),
    )
    manifest['query_embedding_authorization'] = dict(
        query=query, derived_queries=True, source='authorized_context',
        max_requests=1, max_queries=min(6, configured.max_batch_items),
        max_characters=1200, max_input_units=configured.max_batch_input_units,
        request_seconds=15, retrieval_seconds=20,
    )
    manifest['budgets'] = dict(
        model_calls=2 if manifest['kind'] in {'chat', 'propose_actions'} else 1,
        tool_calls=6, model_request_seconds=60, total_seconds=150, queue_seconds=120,
        context_characters=40000, context_input_units=16000,
    )
    manifest['coverage'] = 'selected_excerpts'


async def validate(provider, actor, manifest):
    if manifest.get('retrieval_mode') != 'hybrid':
        return
    configured = profile(provider)
    if profile_hash(configured) != manifest['embedding']['profile_hash']:
        raise WorkspaceError('EMBEDDING_PROFILE_MISMATCH')
    indexes = await freeze(provider, actor, manifest['documents'])
    if content_hash(indexes) != content_hash(manifest['index_versions']):
        raise WorkspaceError('INDEX_CHANGED')
