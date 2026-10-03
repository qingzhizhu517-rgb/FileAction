"""启动独立生成Worker：python -m fileaction.workers。"""
import asyncio
import os
import sys
from sqlalchemy.ext.asyncio import create_async_engine,async_sessionmaker
from redis.asyncio import Redis
from fileaction.core.config import Settings
from fileaction.db.session import create_session_factory
from fileaction.storage_adapters.temporary import TemporaryStore
from fileaction.documents.service import DocumentService
from fileaction.documents.repository import DocumentRepository
from fileaction.workspaces.service import WorkspaceService
from fileaction.workspaces.repository import WorkspaceRepository
from fileaction.runs.repository import RunRepository
from fileaction.runs.service import RunService
from fileaction.agent.gateway import JsonGateway
from fileaction.indexing.routes import configured_profile
from fileaction.indexing.service import IndexingService
from fileaction.indexing.repository import IndexRepository
from fileaction.retrieval.provider import RetrievalProvider
from .generation import GenerationWorker

async def main():
    settings=Settings.from_environment()
    settings.require_core()
    dispatcher_url=os.environ.get('FILEACTION_DISPATCHER_DATABASE_URL')
    if not dispatcher_url: raise RuntimeError('缺少 FILEACTION_DISPATCHER_DATABASE_URL')
    from urllib.parse import urlsplit
    if urlsplit(dispatcher_url).username!='fileaction_dispatch_login': raise RuntimeError('Worker必须使用受限dispatcher账户')
    factory=create_session_factory(settings)
    dispatch_engine=create_async_engine(dispatcher_url,pool_pre_ping=True)
    dispatch=async_sessionmaker(dispatch_engine,expire_on_commit=False)
    redis=Redis.from_url(settings.redis_url,socket_connect_timeout=2,socket_timeout=2)
    temporary=TemporaryStore(redis)
    docs=DocumentService(temporary,repository=DocumentRepository(factory,settings.cos_bucket or '',cursor_secret=settings.app_secret))
    indexing=IndexingService(temporary,docs,IndexRepository(factory),configured_profile(settings))
    workspace=WorkspaceService(temporary,docs,settings,WorkspaceRepository(factory,settings.app_secret),retrieval=RetrievalProvider(indexing))
    service=RunService(workspace,RunRepository(factory,dispatch))
    gateway=JsonGateway(settings.model_base_url,settings.model_name,settings.model_api_key)
    async def consume(slot):
        worker=GenerationWorker(service,gateway)
        while True:
            try:
                active=await worker.tick()
                if not active: await asyncio.sleep(1)
            except asyncio.CancelledError: raise
            except Exception:
                print('WORKER_DEPENDENCY_ERROR',flush=True)
                await asyncio.sleep(2)
    tasks=[asyncio.create_task(consume(i)) for i in range(4)]
    try: await asyncio.gather(*tasks)
    finally:
        for task in tasks: task.cancel()
        await asyncio.gather(*tasks,return_exceptions=True)
        await redis.aclose(); await factory.kw['bind'].dispose(); await dispatch_engine.dispose()

if __name__=='__main__':
    if sys.platform=='win32': asyncio.set_event_loop_policy(asyncio.WindowsSelectorEventLoopPolicy())
    asyncio.run(main())
