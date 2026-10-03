"""供工作区冻结索引范围、Agent只读检索复用的服务端接口。"""
from uuid import UUID
from sqlalchemy import select,and_,String
from fileaction.db.models import documents,document_versions,document_indexes,index_jobs,chunk_segments,document_chunks,embedding_profiles
from fileaction.indexing.embedding import profile_hash
from .core import Scope,RetrievalError,retrieve
from .repository import RetrievalRepository

class RetrievalProvider:
    def __init__(self,indexing):
        self.indexing=indexing
        self.repository=RetrievalRepository(indexing.repository.factory)

    async def active_indexes(self,actor,document_ids):
        if len(document_ids)>20: raise RetrievalError('SCOPE_INVALID')
        result=[]
        svc=self.indexing
        for identifier in document_ids:
            doc=await svc.documents.get(actor,identifier)
            if doc['retention']=='temporary':
                chunks=await svc.active_chunks(actor,identifier)
                if chunks:
                    result.append(dict(document_id=identifier,document_version_id=doc['current_version_id'],index_id=chunks[0].index_id,index_version=1,profile_id=None,profile_hash=chunks[0].profile_key,retention='temporary',chunks=[dict(id=c.id,spans=[dict(segment_id=s.segment_id,start=s.start,end=s.end) for s in c.spans]) for c in chunks]))
                continue
            async with svc.repository.transaction(actor) as db:
                await svc.repository.session_valid(db,actor)
                source=document_indexes.join(document_versions,and_(document_versions.c.id==document_indexes.c.document_version_id,document_versions.c.active_index_id==document_indexes.c.id)).join(documents,and_(documents.c.id==document_versions.c.document_id,documents.c.current_version==document_versions.c.version)).join(embedding_profiles,embedding_profiles.c.id==document_indexes.c.embedding_profile_id).join(index_jobs,index_jobs.c.index_ref==document_indexes.c.id.cast(String))
                row=(await db.execute(select(document_indexes,index_jobs.c.manifest_json).select_from(source).where(documents.c.id==UUID(identifier),documents.c.deletion_state=='active',documents.c.redacted_at.is_(None),document_versions.c.redacted_at.is_(None),document_indexes.c.status=='ready',embedding_profiles.c.active.is_(True),index_jobs.c.status=='succeeded',index_jobs.c.manifest_json['profile_hash'].astext==profile_hash(svc.profile)))).mappings().first()
                if not row: continue
                spans=(await db.execute(select(chunk_segments).join(document_chunks,and_(document_chunks.c.id==chunk_segments.c.chunk_id,document_chunks.c.index_id==chunk_segments.c.index_id)).where(chunk_segments.c.index_id==row['id'],document_chunks.c.redacted_at.is_(None)).order_by(document_chunks.c.ordinal))).mappings().all()
                grouped={}
                for s in spans: grouped.setdefault(str(s['chunk_id']),[]).append(dict(segment_id=str(s['segment_id']),start=s['char_start'],end=s['char_end']))
                result.append(dict(document_id=identifier,document_version_id=str(row['document_version_id']),index_id=str(row['id']),index_version=row['index_version'],profile_id=str(row['embedding_profile_id']),profile_hash=profile_hash(svc.profile),retention='retained',chunks=[dict(id=k,spans=v) for k,v in grouped.items()]))
        return result

    async def search(self,actor,query,scope:Scope,*,mode='hybrid',query_vector=None,max_chars=40000,max_input_units=16000):
        if scope.owner_id!=str(actor.user_id) or scope.session_id!=str(actor.session_id): raise RetrievalError('SCOPE_INVALID')
        if scope.profile_key!=profile_hash(self.indexing.profile): raise RetrievalError('EMBEDDING_PROFILE_MISMATCH')
        if mode=='hybrid' and (query_vector is None or len(query_vector)!=self.indexing.profile.dimensions): raise RetrievalError('EMBEDDING_OUTPUT_INVALID')
        # SQL candidates remain bounded to 20 per ranking; temporary documents
        # are bounded by the 20-document scope and 256 chunks per document.
        persistent=await self.repository.search(actor,query,scope,mode=mode,query_vector=query_vector,max_chars=max_chars,max_input_units=max_input_units,_return_chunks=True)
        temporary=[]
        async with self.indexing.repository.transaction(actor) as db:
            await self.indexing.repository.session_valid(db,actor)
            refs=(await db.execute(select(index_jobs.c.temporary_ref).where(index_jobs.c.index_ref.in_(scope.index_ids),index_jobs.c.temporary_ref.is_not(None),index_jobs.c.auth_session_id==actor.session_id,index_jobs.c.status=='succeeded',index_jobs.c.manifest_json['document_version_id'].astext.in_(scope.document_version_ids)))).scalars().all()
        for identifier in dict.fromkeys(refs):
            temporary.extend(await self.indexing.active_chunks(actor,identifier))
        return retrieve(persistent+temporary,query,scope,mode=mode,query_vector=query_vector,max_chars=max_chars,max_input_units=max_input_units)
