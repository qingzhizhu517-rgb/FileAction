"""授权过滤后的精确SQL召回，不先全库TopK再过滤。"""
import json
import re
from uuid import UUID
from sqlalchemy import text
from fileaction.db.session import tenant_transaction
from .core import Chunk,Span,Scope,RetrievalError,_norm,_valid_vector,retrieve

class RetrievalRepository:
    def __init__(self,factory): self.factory=factory

    async def search(self,actor,query,scope:Scope,*,mode='hybrid',query_vector=None,max_chars=40000,max_input_units=16000,_return_chunks=False):
        if scope.owner_id!=str(actor.user_id) or scope.session_id!=str(actor.session_id): raise RetrievalError('SCOPE_INVALID')
        if len(query)>4000 or len(scope.document_version_ids)>20 or len(scope.index_ids)>20 or len(scope.segment_ids)>5120: raise RetrievalError('SCOPE_INVALID')
        if mode not in ('keyword','hybrid'): raise RetrievalError('RETRIEVAL_REQUEST_INVALID')
        if mode=='hybrid' and (not query_vector or not _valid_vector(query_vector,len(query_vector))): raise RetrievalError('EMBEDDING_OUTPUT_INVALID')
        if not scope.document_version_ids or not scope.index_ids or not scope.segment_ids:
            if _return_chunks: return []
            return retrieve([],query,scope,mode=mode,query_vector=query_vector,max_chars=max_chars,max_input_units=max_input_units)
        words=re.findall(r'[a-z0-9_]+|[\u4e00-\u9fff]+',_norm(query))
        terms=set(words)
        for word in words:
            if re.fullmatch(r'[\u4e00-\u9fff]{3,}',word): terms.update(word[i:i+2] for i in range(len(word)-1))
        params=dict(owner=actor.user_id,versions=[UUID(v) for v in scope.document_version_ids],indexes=[UUID(i) for i in scope.index_ids],segments=[UUID(s) for s in scope.segment_ids],profile=scope.profile_key,
            ranges=json.dumps([dict(segment_id=s,start=a,end=b) for s,a,b in scope.authorized_ranges]),whole=not scope.authorized_ranges,terms=json.dumps(sorted(terms),ensure_ascii=False),
            vector=json.dumps(query_vector or [1.]),dimensions=len(query_vector or ()))
        # MATERIALIZED is intentional: every distance and lexical score only
        # sees owned, current, active-ready, compatible, wholly authorized rows.
        filtered="""WITH filtered AS MATERIALIZED (
          SELECT c.*,e.embedding FROM document_chunks c
          JOIN document_indexes i ON (i.owner_id,i.id,i.document_version_id)=(c.owner_id,c.index_id,c.document_version_id)
          JOIN document_versions v ON (v.owner_id,v.id,v.active_index_id)=(i.owner_id,i.document_version_id,i.id)
          JOIN documents d ON (d.owner_id,d.id,d.current_version)=(v.owner_id,v.document_id,v.version)
          JOIN embedding_profiles p ON p.id=i.embedding_profile_id
          JOIN chunk_embeddings e ON (e.owner_id,e.index_id,e.chunk_id,e.embedding_profile_id)=(c.owner_id,c.index_id,c.id,p.id)
          WHERE c.owner_id=:owner AND c.document_version_id=ANY(:versions) AND c.index_id=ANY(:indexes)
            AND c.redacted_at IS NULL AND v.redacted_at IS NULL AND d.redacted_at IS NULL
            AND d.deletion_state='active' AND i.status='ready' AND p.active AND p.distance_metric='cosine'
            AND EXISTS(SELECT 1 FROM index_jobs j WHERE j.owner_id=c.owner_id AND j.index_ref=CAST(c.index_id AS text)
              AND j.status='succeeded' AND j.manifest_json->>'profile_hash'=:profile)
            AND EXISTS(SELECT 1 FROM chunk_segments m WHERE (m.owner_id,m.index_id,m.chunk_id)=(c.owner_id,c.index_id,c.id))
            AND NOT EXISTS(SELECT 1 FROM chunk_segments m
              LEFT JOIN document_segments s ON (s.owner_id,s.document_version_id,s.id)=(m.owner_id,m.document_version_id,m.segment_id)
              WHERE (m.owner_id,m.index_id,m.chunk_id)=(c.owner_id,c.index_id,c.id)
                AND (s.id IS NULL OR s.redacted_at IS NOT NULL OR m.document_version_id<>c.document_version_id
                  OR NOT(m.segment_id=ANY(:segments)) OR m.char_end>char_length(s.text)
                  OR (NOT :whole AND NOT EXISTS(SELECT 1 FROM jsonb_to_recordset(CAST(:ranges AS jsonb)) AS a(segment_id text,start integer,"end" integer)
                    WHERE a.segment_id=CAST(m.segment_id AS text) AND a.start<=m.char_start AND a."end">=m.char_end AND a.start>=0))))
        ), lexical_scores AS (SELECT id,
          (SELECT coalesce(sum(least((char_length(lower(normalize(f.text,NFKC)))-char_length(replace(lower(normalize(f.text,NFKC)),t.term,'')))/char_length(t.term),3)*char_length(t.term)),0)
           FROM jsonb_array_elements_text(CAST(:terms AS jsonb)) AS t(term)) AS score FROM filtered f),
        lexical AS (SELECT id FROM lexical_scores WHERE score>0 ORDER BY score DESC,id LIMIT 20)
        """
        vector_cte=", vector AS (SELECT id FROM filtered WHERE vector_dims(embedding)=:dimensions ORDER BY embedding <=> CAST(:vector AS vector),id LIMIT 20)" if mode=='hybrid' else ""
        ids_sql=filtered+vector_cte+", selected AS (SELECT id FROM lexical"+(" UNION SELECT id FROM vector" if mode=='hybrid' else '')+")"
        async with tenant_transaction(self.factory,actor) as db:
            # Filter, score, and read originals in one SQL statement snapshot.
            rows=(await db.execute(text(ids_sql+""" SELECT c.id,c.index_id,c.document_version_id,c.embedding::text AS embedding,s.id AS segment_id,
              m.char_start,m.char_end,substring(s.text FROM m.char_start+1 FOR m.char_end-m.char_start) AS original,s.locator_json
              FROM filtered c JOIN selected chosen ON chosen.id=c.id JOIN chunk_segments m ON (m.owner_id,m.chunk_id)=(c.owner_id,c.id)
              JOIN document_segments s ON (s.owner_id,s.document_version_id,s.id)=(m.owner_id,m.document_version_id,m.segment_id)
              ORDER BY c.id,s.ordinal,m.char_start
            """),params)).mappings().all()
        grouped={}
        for r in rows:
            entry=grouped.setdefault(str(r['id']),dict(row=r,spans=[]))
            entry['spans'].append(Span(str(r['segment_id']),r['char_start'],r['char_end'],r['original'],r['locator_json']['label']))
        chunks=[]
        for cid,item in grouped.items():
            r=item['row']
            chunks.append(Chunk(cid,str(actor.user_id),str(r['document_version_id']),str(r['index_id']),scope.profile_key,tuple(item['spans']),tuple(json.loads(r['embedding']))))
        return chunks if _return_chunks else retrieve(chunks,query,scope,mode=mode,query_vector=query_vector,max_chars=max_chars,max_input_units=max_input_units)
