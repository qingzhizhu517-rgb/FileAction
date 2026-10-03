"""受租约保护的生成Worker；sent账本禁止自动重发。"""
import asyncio
from contextlib import suppress
from datetime import datetime,timezone
from uuid import uuid4
from sqlalchemy import update
from fileaction.agent.graph import BoundedAgent, resolve_tools
from fileaction.agent.contracts import Plan
from fileaction.agent.contracts import AgentError
from fileaction.runs.errors import RunError
from fileaction.runs.repository import uid
from fileaction.db.models import run_manifests
from fileaction.db.session import ActorContext
from fileaction.storage_adapters.temporary import TemporaryError
from fileaction.workspaces.service import WorkspaceError,content_hash
from fileaction.indexing.embedding import EmbeddingGateway, EmbeddingConsent, CallBudget, EmbeddingError, profile_hash
from fileaction.retrieval.core import Scope, RetrievalError
from fileaction.indexing.service import IndexingError

class GenerationWorker:
    def __init__(self,service,gateway,*,worker_id=None,embedding_gateway=None):
        self.service,self.gateway=service,gateway
        self.embedding_gateway=embedding_gateway
        self.worker_id=worker_id or 'generation-'+str(uuid4())

    async def tick(self):
        await self.service.recover()
        claimed=await self.service.repository.claim(self.worker_id)
        if not claimed: return False
        probe=ActorContext(claimed['owner_id'],uid('00000000-0000-0000-0000-000000000000'))
        async with self.service.repository.transaction(probe) as db:
            row=await self.service.repository.row(db,claimed['id'])
        actor=ActorContext(row['owner_id'],row['auth_session_id'])
        await self.execute(actor,str(row['id']))
        return True

    async def execute(self,actor,identifier):
        repo=self.service.repository
        task=asyncio.current_task()
        failure=[]
        async def renew():
            while True:
                await asyncio.sleep(10)
                try: await repo.renew(actor,identifier,self.worker_id)
                except Exception:
                    failure.append('LEASE_OR_SESSION_LOST')
                    task.cancel()
                    return
        heartbeat=asyncio.create_task(renew())
        try:
            async with repo.transaction(actor) as db:
                row=await repo.owned_running(db,actor,identifier,self.worker_id)
                header=await repo.manifest_header(db,identifier)
                now=datetime.now(timezone.utc)
                started=header['header_json'].get('started_at')
                if started is None:
                    if (now-row['created_at']).total_seconds()>120: raise RunError('QUEUE_TIMEOUT')
                    started=now.isoformat()
                    await db.execute(update(run_manifests).where(run_manifests.c.id==header['id']).values(header_json={**header['header_json'],'started_at':started}))
                remaining=150-(now-datetime.fromisoformat(started)).total_seconds()
                if remaining<=0: raise RunError('RUN_TIMEOUT')
            async with asyncio.timeout(remaining):
                await repo.phase(actor,identifier,self.worker_id,'preparing_context')
                manifest,_=await self.service.validate_snapshot(actor,identifier)
                number=0
                async def phase(name):
                    await repo.phase(actor,identifier,self.worker_id,name)
                    await self.service.validate_snapshot(actor,identifier)
                async def call(stage,policy,payload):
                    nonlocal number
                    number+=1
                    fingerprint=content_hash([policy,payload])
                    record=await repo.call_record(actor,identifier,number)
                    if record:
                        stored=await self.service.content.get(actor,identifier)
                        response=stored.value.get('responses',{}).get(str(number))
                        if record['state']=='received' and record['request_fingerprint']==fingerprint and response is not None: return response
                        raise RunError('MODEL_OUTCOME_UNKNOWN')
                    await repo.begin_call(actor,identifier,self.worker_id,number,fingerprint)
                    response=await self.gateway.generate(policy,payload)
                    await self.service.content.response(actor,identifier,number,response)
                    await repo.received(actor,identifier,self.worker_id,number)
                    return response
                async def resolve_hybrid(plan):
                    async with asyncio.timeout(20):
                        context=await self._hybrid_context(actor,identifier,manifest,plan)
                        return context, (await self.service.content.get(actor,identifier)).value.get('hybrid_tools',[])
                answer=await BoundedAgent().run(identifier,manifest,call,phase,resolve_hybrid=resolve_hybrid)
                await repo.phase(actor,identifier,self.worker_id,'saving')
                await self.service.commit(actor,identifier,self.worker_id,answer)
        except asyncio.CancelledError:
            await repo.embedding_interrupted(actor,identifier,'WORKER_INTERRUPTED')
            if failure:
                await repo.finish(actor,identifier,'interrupted',failure[0],self.worker_id)
            else:
                raise
        except (RunError,AgentError,TemporaryError,WorkspaceError,EmbeddingError,RetrievalError,IndexingError,TimeoutError) as exc:
            code='RUN_TIMEOUT' if isinstance(exc,TimeoutError) else str(exc)
            await repo.embedding_interrupted(actor,identifier,code)
            state='interrupted' if code in {'MODEL_OUTCOME_UNKNOWN','EMBEDDING_OUTCOME_UNKNOWN'} else 'stale' if code in {'RUN_STALE','SOURCE_CHANGED','MODEL_CONFIG_CHANGED','REVISION_CONFLICT','INDEX_CHANGED','EMBEDDING_PROFILE_MISMATCH'} else 'failed'
            await repo.finish(actor,identifier,state,code,self.worker_id)
        except Exception:
            raise
        finally:
            heartbeat.cancel()
            with suppress(asyncio.CancelledError): await heartbeat
            try:
                row,_=await repo.get(actor,identifier)
                if row['status'] not in {'queued','running'}: await self.service.content.release(actor,row['temporary_ref'],identifier)
            except (RunError,TemporaryError): pass

    async def _hybrid_context(self, actor, identifier, manifest, plan=None):
        provider = self.service.workspaces.retrieval
        if provider is None or provider.indexing.profile is None:
            raise WorkspaceError('EMBEDDING_NOT_CONFIGURED')
        gateway = self.embedding_gateway
        if gateway is None:
            profile = provider.indexing.profile
            gateway = EmbeddingGateway(profile)
        profile = gateway.profile
        if profile_hash(profile) != manifest['embedding']['profile_hash']:
            raise WorkspaceError('EMBEDDING_PROFILE_MISMATCH')
        requests=list(plan.evidence_requests) if plan else []
        searches=[r for r in requests if r.tool=='search_evidence']
        docs=manifest['documents']
        known={d['document_id'] for d in docs}
        for request in searches:
            if any(identifier not in known for identifier in request.arguments.document_ids):
                raise AgentError('TOOL_SCOPE_INVALID')
        if not searches:
            if len(requests)>=6: raise AgentError('TOOL_BUDGET_EXCEEDED')
            from fileaction.agent.contracts import SearchRequest
            searches=[SearchRequest(tool='search_evidence',arguments=dict(query=manifest['query'],document_ids=list(known),limit=12))]
        queries=list(dict.fromkeys(r.arguments.query for r in searches))
        authorization=manifest['query_embedding_authorization']
        if len(queries)>authorization['max_queries'] or sum(len(q) for q in queries)>authorization['max_characters']:
            raise AgentError('EMBEDDING_BUDGET_EXCEEDED')
        # Validate all remaining read-only arguments before any external send.
        others=[r for r in requests if r.tool!='search_evidence']
        other_results=resolve_tools(Plan(intent='answer_question',evidence_requests=others,needs_user_input=False,question=None),manifest)
        request_hash = content_hash([manifest['embedding']['profile_hash'], queries])
        await self.service.validate_snapshot(actor,identifier)
        record=await self.service.repository.begin_embedding(actor, identifier, self.worker_id, request_hash)
        if record:
            saved=(await self.service.content.get(actor,identifier)).value.get('query_embedding')
            if not saved or saved['request_hash']!=request_hash:
                raise RunError('EMBEDDING_OUTCOME_UNKNOWN')
            vectors=saved['vectors']
        else:
            consent = EmbeddingConsent.for_texts(queries, purpose='query', profile=profile)
            result = await gateway.embed(queries, consent=consent, budget=CallBudget(1, max_seconds=15))
            await self.service.validate_snapshot(actor,identifier)
            await self.service.content.save_section(actor,identifier,'query_embedding',dict(request_hash=request_hash,queries=queries,vectors=result.vectors))
            await self.service.repository.embedding_received(actor, identifier, self.worker_id, {'total_tokens': result.usage_tokens, 'cost_status': 'unknown'})
            vectors=result.vectors
        await self.service.validate_snapshot(actor,identifier)
        evidence=[]; records=[]; tool_results=[]
        for number,request in enumerate(searches):
            selected=set(request.arguments.document_ids) or known
            subset=[d for d in docs if d['document_id'] in selected]
            versions=frozenset(d['document_version_id'] for d in subset)
            indexes=tuple(i['index_id'] for i in manifest['index_versions'] if i['document_id'] in selected)
            segments=frozenset(s['segment_id'] for d in subset for s in d['segments'])
            ranges=tuple((s['segment_id'],s['char_start'],s['char_end']) for d in subset for s in d['segments'])
            scope=Scope(str(actor.user_id),str(actor.session_id),versions,segments,frozenset(indexes),manifest['embedding']['profile_hash'],ranges)
            found=await provider.search(actor,request.arguments.query,scope,mode='hybrid',query_vector=vectors[queries.index(request.arguments.query)],max_chars=40000,max_input_units=16000)
            spans=list(found.evidence)[:request.arguments.limit]
            evidence.extend(spans)
            tool_results.append([dict(segment_id=s.segment_id,char_start=s.start,char_end=s.end,text=s.text,location=s.locator) for s in spans])
            records.append(dict(chunk_ids=found.chunk_ids,lexical_ids=found.lexical_ids,vector_ids=found.vector_ids,evidence=tool_results[-1]))
            await self.service.repository.record_retrieval(actor,identifier,'hybrid',list(indexes),content_hash(ranges),identifier+':query:'+str(number),identifier+':retrieval:'+str(number),self.worker_id,number)
        await self.service.content.save_section(actor,identifier,'query_retrieval',records)
        filtered = []
        for doc in docs:
            parts = []
            for segment in doc['segments']:
                for span in evidence:
                    if span.segment_id!=segment['segment_id']: continue
                    start, end = max(segment['char_start'], span.start), min(segment['char_end'], span.end)
                    if start < end:
                        excerpt=segment['text'][start-segment['char_start']:end-segment['char_start']]
                        part={**segment,'char_start':start,'char_end':end,'text':excerpt,'content_hash':content_hash(excerpt)}
                        if part not in parts: parts.append(part)
            if parts:
                filtered.append({**doc, 'segments': parts})
        context={**manifest,'documents':filtered,'coverage':'selected_excerpts'}
        await self.service.content.save_section(actor,identifier,'hybrid_tools',tool_results+other_results)
        await self.service.validate_snapshot(actor,identifier)
        return context
