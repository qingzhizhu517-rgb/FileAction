"""预览与独立索引快照，严格独立于生成授权。"""
from dataclasses import asdict, replace
import hashlib
import json
from urllib.parse import urlsplit
from uuid import uuid4,uuid5,UUID
from datetime import datetime,timezone
from contextlib import suppress
from sqlalchemy import select,update,delete,func
from fileaction.db.models import index_jobs,embedding_calls,document_indexes,document_versions,documents,document_chunks,chunk_segments,chunk_embeddings
from fileaction.retrieval.core import SourceSegment, Span, build_chunks
from fileaction.storage_adapters.temporary import TemporaryStore,TemporaryError
from .embedding import content_hash,profile_hash

class IndexingError(ValueError):
    pass

def digest(value):
    return hashlib.sha256(json.dumps(value,ensure_ascii=False,sort_keys=True,separators=(',',':')).encode()).hexdigest()

class IndexingService:
    def __init__(self,temporary,documents,repository,profile):
        self.temporary,self.documents,self.repository,self.profile=temporary,documents,repository,profile
        self.previews=TemporaryStore(temporary.redis,idle_seconds=120,hard_seconds=120,max_derived_bytes=temporary.max_derived_bytes)

    async def _manifest(self,actor,identifier,request):
        if self.profile is None: raise IndexingError('EMBEDDING_NOT_CONFIGURED')
        value=await self.documents._value(actor,identifier)
        if value['revision']!=request.expected_revision: raise IndexingError('REVISION_CONFLICT')
        if value['current_version_id']!=request.document_version_id: raise IndexingError('PREVIEW_STALE')
        if value['parse_status']!='ready': raise IndexingError('DOCUMENT_NOT_READY')
        sources={s['id']:s for s in value['segments']}
        selections=request.selections
        ranges=[(s.segment_id,s.char_start,s.char_end) for s in selections] if selections else [(s['id'],0,len(s['text'])) for s in sources.values() if s['text']]
        if len({sid for sid,_,_ in ranges})!=len(ranges): raise IndexingError('SCOPE_INVALID')
        segments=[]
        offsets={}
        for sid,start,end in ranges:
            source=sources.get(sid)
            if source is None or not 0<=start<end<=len(source['text']): raise IndexingError('SCOPE_INVALID')
            offsets[sid]=start
            segments.append(SourceSegment(sid,str(actor.user_id),value['current_version_id'],source['location'],source['text'][start:end]))
        chunks=build_chunks(segments,index_id='preview',profile_key=profile_hash(self.profile))
        chunks=[replace(c,spans=tuple(Span(s.segment_id,s.start+offsets[s.segment_id],s.end+offsets[s.segment_id],s.text,s.locator) for s in c.spans)) for c in chunks]
        if not chunks: raise IndexingError('SCOPE_INVALID')
        batches=[]
        current=[]
        units=0
        for c in chunks:
            size=len(c.text.encode())
            if size>self.profile.max_batch_input_units: raise IndexingError('EMBEDDING_INPUT_TOO_LARGE')
            if current and (len(current)>=min(32,self.profile.max_batch_items) or units+size>self.profile.max_batch_input_units):
                batches.append(current); current=[]; units=0
            current.append(c.id); units+=size
        if current: batches.append(current)
        if len(batches)>16: raise IndexingError('EMBEDDING_BUDGET_EXCEEDED')
        return dict(document_id=identifier,document_version_id=value['current_version_id'],revision=value['revision'],retention=value['retention'],
            profile_hash=profile_hash(self.profile),provider_domain=urlsplit(self.profile.base_url).hostname,model=self.profile.model,dimensions=self.profile.dimensions,profile_version=self.profile.version,
            parser_version='1',chunker_version='1',ranges=ranges,chunks=[{**asdict(c),'text':c.text,'text_hash':content_hash(c.text)} for c in chunks],batches=batches,
            budgets=dict(max_requests=16,max_batch_items=min(32,self.profile.max_batch_items),request_seconds=30,total_seconds=300,queue_seconds=300))

    async def preview(self,actor,identifier,request):
        manifest=await self._manifest(actor,identifier,request)
        value=dict(manifest=manifest,request=request.model_dump(),manifest_hash=digest(manifest))
        preview=await self.previews.create(actor,'preview',value)
        return dict(preview_id=preview.id,manifest_hash=value['manifest_hash'],expires_in=120,**manifest)

    async def validate_preview(self,actor,identifier,preview_id,manifest_hash,revision):
        from .dto import IndexPreviewRequest
        try: preview=(await self.previews.get(actor,'preview',preview_id)).value
        except TemporaryError: raise IndexingError('PREVIEW_EXPIRED') from None
        manifest=preview.get('manifest',{})
        if manifest.get('document_id')!=identifier or manifest.get('revision')!=revision or manifest_hash!=preview.get('manifest_hash'): raise IndexingError('PREVIEW_STALE')
        current=await self._manifest(actor,identifier,IndexPreviewRequest.model_validate(preview['request']))
        if digest(current)!=manifest_hash: raise IndexingError('PREVIEW_STALE')
        return manifest

    async def create(self,actor,identifier,key,body):
        if not body.get('consent_to_embed'): raise IndexingError('CONSENT_REQUIRED')
        if self.repository is None: raise IndexingError('DEPENDENCY_UNAVAILABLE')
        if not isinstance(key,str) or not 1<=len(key)<=160: raise IndexingError('IDEMPOTENCY_KEY_REQUIRED')
        from .dto import IndexCreateRequest
        body=IndexCreateRequest.model_validate(body).model_dump()
        request_hash=digest([identifier,body])
        repo=self.repository
        async with repo.transaction(actor) as db:
            await repo.session_valid(db,actor)
            previous=await repo.prior(db,actor,key,request_hash)
        if previous: return await self.get(actor,str(previous['id']))
        manifest=await self.validate_preview(actor,identifier,body['preview_id'],body['manifest_hash'],body['expected_revision'])
        job_id,index_id=str(uuid4()),str(uuid4())
        snapshot=dict(manifest=manifest,index_id=index_id,responses={},ready=False,deleted=False)
        reused=None
        confirmed_reuse={}
        if body.get('retry_job_id'):
            prior=await repo.get(actor,body['retry_job_id'])
            if prior['status'] in ('queued','running','succeeded','cancelled') or prior['manifest_json']['manifest_hash']!=body['manifest_hash']: raise IndexingError('RETRY_SCOPE_CHANGED')
            if prior['status']=='interrupted' and not body['accept_possible_duplicate_cost']: raise IndexingError('COST_ACKNOWLEDGEMENT_REQUIRED')
            reused=await self.snapshot(actor,body['retry_job_id'])
            rows=await repo.call_rows(actor,body['retry_job_id'])
            for call in rows:
                number=call['batch_no']
                key_number=str(number)
                if call['state'] not in ('received','committed') or key_number not in reused.get('responses',{}) or number>=len(manifest['batches']): continue
                batch=manifest['batches'][number]
                by_id={c['id']:c for c in manifest['chunks']}
                if call['request_hash']!=digest([manifest['profile_hash'],[by_id[c]['text'] for c in batch]]): continue
                if set(reused['responses'][key_number])!=set(batch): continue
                confirmed_reuse[key_number]=call
                snapshot['responses'][key_number]=reused['responses'][key_number]
            snapshot['reused_from']=body['retry_job_id']
        temporary=manifest['retention']=='temporary'
        if temporary:
            # Preallocate conservative JSON vector capacity before queue admission.
            snapshot['reservation']=' '*(len(manifest['chunks'])*manifest['dimensions']*32)
            await self.temporary.create(actor,'index',snapshot,resource_id=index_id)
        try:
            async with repo.transaction(actor) as db:
                await repo.lock(db,actor)
                await repo.session_valid(db,actor)
                previous=await repo.prior(db,actor,key,request_hash)
                if previous:
                    if temporary: await self.temporary.delete(actor,'index',index_id)
                    return await self.get(actor,str(previous['id']))
                row=await repo.add(db,actor,job_id,index_id,key,request_hash,manifest,body['manifest_hash'])
                from sqlalchemy import insert
                for number,record in confirmed_reuse.items():
                    await db.execute(insert(embedding_calls).values(id=uuid4(),owner_id=actor.user_id,index_job_id=UUID(job_id),batch_no=int(number),request_hash=record['request_hash'],content_ref=index_id+':'+number,response_ref=record['response_ref'],state='committed',usage_json={'reused':True,'source_job_id':body['retry_job_id'],'cost_status':'no_new_request'}))
                if not temporary and reused:
                    header=dict(row['manifest_json'],responses=snapshot['responses'])
                    await db.execute(update(index_jobs).where(index_jobs.c.id==row['id']).values(manifest_json=header))
            return self.public(row)
        except BaseException:
            if temporary:
                with suppress(TemporaryError): await self.temporary.delete(actor,'index',index_id)
            raise

    @staticmethod
    def public(row):
        return dict(id=str(row['id']),index_id=row['index_ref'],status=row['status'],completed_chunks=row['completed_chunks'],total_chunks=row['manifest_json'].get('total_chunks',row['reserved_chunks']),error_code=row['error_code'],cost_status='unknown',created_at=row['created_at'].isoformat())

    async def get(self,actor,identifier):
        row=await self.repository.get(actor,identifier)
        if row['temporary_ref'] and row['status']=='succeeded':
            try: await self.temporary.get(actor,'index',row['index_ref'])
            except TemporaryError as error:
                if str(error)!='TEMPORARY_CONTENT_EXPIRED': raise
                async with self.repository.transaction(actor) as db:
                    await self.repository.session_valid(db,actor)
                    await db.execute(update(index_jobs).where(index_jobs.c.id==row['id'],index_jobs.c.status=='succeeded').values(status='failed',error_code='TEMPORARY_CONTENT_EXPIRED',reserved_chunks=0,reserved_bytes=0,completed_chunks=0,updated_at=func.now()))
                    row=await self.repository.row(db,identifier)
        return self.public(row)

    async def recover(self):
        for actor,identifier in await self.repository.recover():
            await self.release_unused(actor,identifier)

    async def snapshot(self,actor,identifier):
        row=await self.repository.get(actor,identifier)
        if row['temporary_ref']:
            return (await self.temporary.get(actor,'index',row['index_ref'])).value
        return dict(manifest=row['manifest_json']['manifest'],responses=row['manifest_json'].get('responses',{}),index_id=row['index_ref'])

    async def validate_snapshot(self,actor,identifier):
        from .dto import IndexPreviewRequest
        snap=await self.snapshot(actor,identifier)
        manifest=snap['manifest']
        request=IndexPreviewRequest(expected_revision=manifest['revision'],document_version_id=manifest['document_version_id'],selections=[dict(segment_id=s,char_start=a,char_end=b) for s,a,b in manifest['ranges']])
        current=await self._manifest(actor,manifest['document_id'],request)
        if digest(current)!=digest(manifest): raise IndexingError('PREVIEW_STALE')
        return snap

    async def cancel(self,actor,identifier,confirmed):
        if confirmed is not True: raise IndexingError('CONFIRMATION_REQUIRED')
        await self.repository.get(actor,identifier)
        await self.repository.finish(actor,identifier,'cancelled','USER_CANCELLED')
        await self.release_unused(actor,identifier)
        return await self.get(actor,identifier)

    async def release_unused(self,actor,identifier):
        repo=self.repository
        async with repo.transaction(actor) as db:
            row=await repo.row(db,identifier,True)
            if row['auth_session_id']!=actor.session_id or row['status'] in ('queued','running','succeeded'): return
            if row['temporary_ref']:
                with suppress(TemporaryError):
                    resource=await self.temporary.get(actor,'index',row['index_ref'])
                    if resource.value.get('reservation'):
                        await self.temporary.replace(actor,'index',row['index_ref'],dict(resource.value,reservation=''),expected_revision=resource.revision)
            else:
                count=await db.scalar(select(func.count()).select_from(document_chunks).where(document_chunks.c.index_id==UUID(row['index_ref'])))
                dimension=row['manifest_json'].get('manifest',{}).get('dimensions',0)
                await db.execute(update(index_jobs).where(index_jobs.c.id==row['id']).values(reserved_chunks=count,completed_chunks=count,reserved_bytes=count*dimension*4))

    async def received(self,actor,identifier,worker,epoch,number,vectors,usage):
        repo=self.repository
        snapshot=await self.validate_snapshot(actor,identifier)
        batch=snapshot['manifest']['batches'][number]
        if len(batch)!=len(vectors): raise IndexingError('EMBEDDING_OUTPUT_INVALID')
        async with repo.transaction(actor) as db:
            row=await repo.owned(db,actor,identifier,worker,epoch)
            responses=dict(snapshot.get('responses',{}))
            responses[str(number)]=dict(zip(batch,[list(v) for v in vectors],strict=True))
            done=sum(len(v) for v in responses.values())
            if row['temporary_ref']:
                resource=await self.temporary.get(actor,'index',row['index_ref'])
                value=dict(resource.value,responses=responses)
                value['reservation']=' '*((len(snapshot['manifest']['chunks'])-done)*self.profile.dimensions*32)
                await self.temporary.replace(actor,'index',row['index_ref'],value,expected_revision=resource.revision)
            else:
                await self._store_chunks(db,actor,row,snapshot['manifest'],responses[str(number)])
                await db.execute(update(index_jobs).where(index_jobs.c.id==row['id']).values(manifest_json=dict(row['manifest_json'],responses=responses)))
            await db.execute(update(embedding_calls).where(embedding_calls.c.index_job_id==row['id'],embedding_calls.c.batch_no==number,embedding_calls.c.state=='sent').values(state='received',response_ref=row['index_ref']+':'+str(number),usage_json=dict(total_tokens=usage,cost_status='unknown')))
            await db.execute(update(index_jobs).where(index_jobs.c.id==row['id']).values(completed_chunks=done))

    async def _store_chunks(self,db,actor,row,manifest,vectors):
        from sqlalchemy import insert
        index_id=UUID(row['index_ref'])
        profile=await self.repository.configured_profile(db,manifest)
        for ordinal,chunk in enumerate(manifest['chunks']):
            if chunk['id'] not in vectors: continue
            chunk_id=uuid5(index_id,chunk['id'])
            exists=await db.scalar(select(document_chunks.c.id).where(document_chunks.c.id==chunk_id))
            if exists: continue
            await db.execute(insert(document_chunks).values(id=chunk_id,owner_id=actor.user_id,index_id=index_id,document_version_id=UUID(manifest['document_version_id']),ordinal=ordinal,text=chunk['text'],text_hash=chunk['text_hash'],char_count=len(chunk['text'])))
            for span in chunk['spans']:
                await db.execute(insert(chunk_segments).values(id=uuid4(),owner_id=actor.user_id,chunk_id=chunk_id,index_id=index_id,document_version_id=UUID(manifest['document_version_id']),segment_id=UUID(span['segment_id']),char_start=span['start'],char_end=span['end']))
            await db.execute(insert(chunk_embeddings).values(id=uuid4(),owner_id=actor.user_id,chunk_id=chunk_id,index_id=index_id,embedding_profile_id=profile,embedding=vectors[chunk['id']],text_hash=chunk['text_hash']))

    async def commit(self,actor,identifier,worker,epoch):
        repo=self.repository
        snap=await self.validate_snapshot(actor,identifier)
        manifest=snap['manifest']
        vectors={key:value for batch in snap.get('responses',{}).values() for key,value in batch.items()}
        if set(vectors)!={c['id'] for c in manifest['chunks']}: raise IndexingError('INDEX_INCOMPLETE')
        old_temporary=[]
        async with repo.transaction(actor) as db:
            await repo.lock(db,actor)
            row=await repo.owned(db,actor,identifier,worker,epoch)
            if row['temporary_ref']:
                previous=(await db.execute(select(index_jobs).where(index_jobs.c.temporary_ref==row['temporary_ref'],index_jobs.c.auth_session_id==actor.session_id,index_jobs.c.status=='succeeded',index_jobs.c.id!=row['id']).with_for_update())).mappings().all()
                old_temporary=[r['index_ref'] for r in previous]
                await db.execute(update(index_jobs).where(index_jobs.c.index_ref.in_(old_temporary)).values(status='stale',updated_at=func.now()))
                current=await self.temporary.get(actor,'document',manifest['document_id'])
                if current.value['current_version_id']!=manifest['document_version_id']: raise IndexingError('PREVIEW_STALE')
                resource=await self.temporary.get(actor,'index',row['index_ref'])
                if resource.value.get('deleted'): raise IndexingError('INDEX_NOT_ACTIVE')
                await self.temporary.replace(actor,'index',row['index_ref'],dict(resource.value,ready=True,reservation=''),expected_revision=resource.revision)
                # All readers also require succeeded PG state; this pre-commit
                # Redis flag can never publish a failed database transaction.
            else:
                doc=(await db.execute(select(documents).where(documents.c.id==UUID(manifest['document_id'])).with_for_update())).mappings().first()
                version=(await db.execute(select(document_versions).where(document_versions.c.id==row['document_version_id']).with_for_update())).mappings().first()
                if not doc or not version or doc['deletion_state']!='active' or doc['revision']!=manifest['revision'] or doc['current_version']!=version['version'] or version['redacted_at']: raise IndexingError('PREVIEW_STALE')
                await self._store_chunks(db,actor,row,manifest,vectors)
                old=version['active_index_id']
                if old: await db.execute(update(document_indexes).where(document_indexes.c.id==old).values(status='stale'))
                await db.execute(update(document_indexes).where(document_indexes.c.id==UUID(row['index_ref'])).values(status='ready',updated_at=func.now()))
                await db.execute(update(document_versions).where(document_versions.c.id==version['id']).values(active_index_id=UUID(row['index_ref'])))
            await db.execute(update(embedding_calls).where(embedding_calls.c.index_job_id==row['id'],embedding_calls.c.state=='received').values(state='committed'))
            await db.execute(update(index_jobs).where(index_jobs.c.id==row['id']).values(status='succeeded',completed_chunks=len(vectors),lease_until=None,updated_at=func.now()))
        for ref in old_temporary:
            with suppress(TemporaryError): await self.temporary.delete(actor,'index',ref)

    async def delete_indexes(self,actor,identifier,revision,confirmed):
        if confirmed is not True: raise IndexingError('CONFIRMATION_REQUIRED')
        doc=await self.documents.get(actor,identifier)
        if doc['revision']!=revision: raise IndexingError('REVISION_CONFLICT')
        refs=[]
        repo=self.repository
        async with repo.transaction(actor) as db:
            await repo.lock(db,actor)
            await repo.session_valid(db,actor)
            rows=(await db.execute(select(index_jobs).where(index_jobs.c.manifest_json['document_id'].astext==identifier).with_for_update())).mappings().all()
            for row in rows:
                if row['temporary_ref'] and row['auth_session_id']!=actor.session_id: continue
                refs.append(row['index_ref'])
                await db.execute(update(index_jobs).where(index_jobs.c.id==row['id']).values(status='cancelled',error_code='INDEX_DELETED',lease_until=None))
            if doc['retention']=='retained':
                await db.execute(update(document_versions).where(document_versions.c.document_id==UUID(identifier)).values(active_index_id=None))
                await db.execute(update(document_indexes).where(document_indexes.c.id.in_([UUID(r) for r in refs])).values(status='deleted'))
        # Revoke first, cleanup second. Late workers cannot pass the locked job.
        cleanup_failed=False
        if doc['retention']=='temporary':
            for ref in refs:
                try: await self.temporary.delete(actor,'index',ref)
                except TemporaryError as error:
                    if str(error)=='TEMPORARY_CONTENT_EXPIRED': continue
                    cleanup_failed=True
                    async with repo.transaction(actor) as db:
                        await db.execute(update(index_jobs).where(index_jobs.c.index_ref==ref,index_jobs.c.auth_session_id==actor.session_id).values(error_code='INDEX_CLEANUP_PENDING'))
        else:
            async with repo.transaction(actor) as db:
                for table in (chunk_embeddings,chunk_segments,document_chunks):
                    await db.execute(delete(table).where(table.c.index_id.in_([UUID(r) for r in refs])))
                await db.execute(update(index_jobs).where(index_jobs.c.index_ref.in_(refs)).values(reserved_chunks=0,reserved_bytes=0,completed_chunks=0,manifest_json=index_jobs.c.manifest_json.op('-')('responses').op('-')('manifest')))
        return dict(status='cleanup_pending' if cleanup_failed else 'deleted')

    async def active_chunks(self,actor,identifier):
        from fileaction.retrieval.core import Chunk,Span
        doc=await self.documents.get(actor,identifier)
        if doc['retention']!='temporary': raise IndexingError('USE_SQL_RETRIEVAL')
        async with self.repository.transaction(actor) as db:
            await self.repository.session_valid(db,actor)
            rows=(await db.execute(select(index_jobs).where(index_jobs.c.temporary_ref==identifier,index_jobs.c.auth_session_id==actor.session_id,index_jobs.c.status=='succeeded').order_by(index_jobs.c.updated_at.desc()).limit(1))).mappings().all()
        for row in rows:
            try: snap=(await self.temporary.get(actor,'index',row['index_ref'])).value
            except TemporaryError: continue
            m=snap['manifest']
            if not snap.get('ready') or snap.get('deleted') or m['document_version_id']!=doc['current_version_id'] or m['profile_hash']!=profile_hash(self.profile): continue
            vectors={k:tuple(v) for batch in snap['responses'].values() for k,v in batch.items()}
            latest=await self.repository.get(actor,str(row['id']))
            if latest['status']!='succeeded': return []
            return [Chunk(c['id'],str(actor.user_id),m['document_version_id'],row['index_ref'],m['profile_hash'],tuple(Span(**s) for s in c['spans']),vectors[c['id']],str(actor.session_id)) for c in m['chunks']]
        return []
