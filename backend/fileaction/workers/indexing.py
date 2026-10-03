"""独立索引Worker；不共享生成预算或静默重发未知费用请求。"""
import asyncio
from contextlib import suppress
from datetime import datetime,timezone
from uuid import uuid4
from fileaction.db.session import ActorContext
from fileaction.indexing.embedding import EmbeddingConsent,CallBudget,EmbeddingError,profile_hash
from fileaction.indexing.service import IndexingError,digest
from fileaction.storage_adapters.temporary import TemporaryError
from fileaction.documents.service import DocumentError

class IndexingWorker:
    def __init__(self,service,gateway,*,worker_id=None):
        self.service,self.gateway=service,gateway
        self.worker_id=worker_id or 'index-'+str(uuid4())

    async def tick(self):
        await self.service.recover()
        claimed=await self.service.repository.claim(self.worker_id)
        if not claimed: return False
        actor=ActorContext(claimed['owner_id'],claimed['auth_session_id'])
        await self.execute(actor,str(claimed['id']),claimed['lease_epoch'])
        return True

    async def execute(self,actor,identifier,epoch):
        svc=self.service
        repo=svc.repository
        task=asyncio.current_task()
        lost=[]
        async def heartbeat():
            while True:
                await asyncio.sleep(10)
                try: await repo.renew(actor,identifier,self.worker_id,epoch)
                except Exception:
                    lost.append(True); task.cancel(); return
        renew=asyncio.create_task(heartbeat())
        try:
            row=await repo.get(actor,identifier)
            remaining=300-(datetime.now(timezone.utc)-row['started_at']).total_seconds()
            if remaining<=0: raise IndexingError('INDEX_TIMEOUT')
            async with asyncio.timeout(remaining):
                snap=await svc.validate_snapshot(actor,identifier)
                manifest=snap['manifest']
                if profile_hash(self.gateway.profile)!=manifest['profile_hash']: raise IndexingError('EMBEDDING_PROFILE_MISMATCH')
                lookup={c['id']:c for c in manifest['chunks']}
                budget=CallBudget(16,max_seconds=remaining)
                existing=await repo.call_rows(actor,identifier)
                if any(r['state'] in ('sent','interrupted') for r in existing): raise IndexingError('EMBEDDING_OUTCOME_UNKNOWN')
                for number,batch in enumerate(manifest['batches']):
                    if str(number) in snap.get('responses',{}): continue
                    await svc.validate_snapshot(actor,identifier)
                    texts=[lookup[c]['text'] for c in batch]
                    await repo.begin_call(actor,identifier,self.worker_id,epoch,number,digest([manifest['profile_hash'],texts]))
                    consent=EmbeddingConsent.for_texts(texts,purpose='document_index',profile=self.gateway.profile)
                    async with asyncio.timeout(min(30,remaining)):
                        result=await self.gateway.embed(texts,consent=consent,budget=budget)
                    await svc.received(actor,identifier,self.worker_id,epoch,number,result.vectors,result.usage_tokens)
                await svc.commit(actor,identifier,self.worker_id,epoch)
        except asyncio.CancelledError:
            await repo.finish(actor,identifier,'interrupted','LEASE_EXPIRED' if lost else 'WORKER_INTERRUPTED',self.worker_id,epoch)
            if not lost: raise
        except (IndexingError,EmbeddingError,TemporaryError,DocumentError,TimeoutError) as error:
            calls=await repo.call_rows(actor,identifier)
            unknown=any(c['state']=='sent' for c in calls)
            code='EMBEDDING_OUTCOME_UNKNOWN' if unknown else str(error) or 'INDEX_TIMEOUT'
            await repo.finish(actor,identifier,'interrupted' if unknown else 'failed',code,self.worker_id,epoch)
        finally:
            renew.cancel()
            with suppress(asyncio.CancelledError): await renew
            await svc.release_unused(actor,identifier)
