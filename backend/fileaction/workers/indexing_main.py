"""python -m fileaction.workers.indexing_main：独立两槽索引Worker。"""
import asyncio
import os
import sys
from urllib.parse import urlsplit
from sqlalchemy.ext.asyncio import create_async_engine,async_sessionmaker
from redis.asyncio import Redis
from fileaction.core.config import Settings
from fileaction.db.session import create_session_factory
from fileaction.storage_adapters.temporary import TemporaryStore
from fileaction.documents.service import DocumentService
from fileaction.documents.repository import DocumentRepository
from fileaction.indexing.service import IndexingService
from fileaction.indexing.repository import IndexRepository
from fileaction.indexing.embedding import EmbeddingGateway
from fileaction.indexing.routes import configured_profile
from .indexing import IndexingWorker

async def main():
    settings=Settings.from_environment()
    settings.require_core()
    profile=configured_profile(settings)
    if profile is None: raise RuntimeError('需要独立Embedding配置，禁止使用聊天凭据替代')
    dispatcher=os.environ.get('FILEACTION_DISPATCHER_DATABASE_URL','')
    if urlsplit(dispatcher).username!='fileaction_dispatch_login': raise RuntimeError('索引Worker必须使用受限dispatcher账户')
    factory=create_session_factory(settings)
    dispatch_engine=create_async_engine(dispatcher,pool_pre_ping=True)
    redis=Redis.from_url(settings.redis_url,socket_connect_timeout=2,socket_timeout=2)
    temporary=TemporaryStore(redis)
    docs=DocumentService(temporary,DocumentRepository(factory,settings.cos_bucket or '',cursor_secret=settings.app_secret))
    svc=IndexingService(temporary,docs,IndexRepository(factory,async_sessionmaker(dispatch_engine,expire_on_commit=False)),profile)
    async def consume():
        worker=IndexingWorker(svc,EmbeddingGateway(profile))
        while True:
            try:
                if not await worker.tick(): await asyncio.sleep(1)
            except asyncio.CancelledError: raise
            except Exception:
                print('INDEX_WORKER_DEPENDENCY_ERROR',flush=True)
                await asyncio.sleep(2)
    tasks=[asyncio.create_task(consume()) for _ in range(2)]
    try: await asyncio.gather(*tasks)
    finally:
        for task in tasks: task.cancel()
        await asyncio.gather(*tasks,return_exceptions=True)
        await redis.aclose(); await factory.kw['bind'].dispose(); await dispatch_engine.dispose()

if __name__=='__main__':
    if sys.platform=='win32': asyncio.set_event_loop_policy(asyncio.WindowsSelectorEventLoopPolicy())
    asyncio.run(main())
