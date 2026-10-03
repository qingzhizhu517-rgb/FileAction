"""显式合成验收入口，正式服务不会导入。

将固定测试域名的Embedding请求转到回环HTTP测试服务器。此传输替身
仅验证工程流程，不验证HTTPS或任何真实Embedding供应商。
"""
import asyncio
import os
import sys
from urllib.parse import urlsplit
import httpx


def main():
    if os.environ.get('FILEACTION_SYNTHETIC_HTTP_GATEWAY') != '1':
        raise SystemExit('必须显式启用合成验收模式')
    parsed = urlsplit(os.environ.get('FILEACTION_SYNTHETIC_EMBEDDING_TARGET', ''))
    if parsed.scheme != 'http' or parsed.hostname != '127.0.0.1' or not parsed.port or parsed.path:
        raise SystemExit('合成Embedding目标必须是带端口的本机回环HTTP地址')
    from fileaction.indexing.embedding import EmbeddingGateway
    original = EmbeddingGateway.__init__

    class LocalSyntheticTransport(httpx.AsyncHTTPTransport):
        async def handle_async_request(self, request):
            if request.url.host != 'synthetic.invalid' or request.url.path != '/v1/embeddings':
                raise RuntimeError('合成验收拒绝非固定Embedding地址')
            request.url = request.url.copy_with(scheme='http', host='127.0.0.1', port=parsed.port)
            request.headers['host'] = '127.0.0.1:' + str(parsed.port)
            return await super().handle_async_request(request)

    def initialized(self, profile, *, transport=None):
        original(self, profile, transport=transport or LocalSyntheticTransport())
    EmbeddingGateway.__init__ = initialized
    if sys.platform == 'win32':
        asyncio.set_event_loop_policy(asyncio.WindowsSelectorEventLoopPolicy())
    if len(sys.argv) != 2 or sys.argv[1] not in {'generation', 'indexing'}:
        raise SystemExit('指定 generation 或 indexing')
    if sys.argv[1] == 'indexing':
        from fileaction.workers.indexing_main import main as worker_main
    else:
        from fileaction.workers.__main__ import main as worker_main
    asyncio.run(worker_main())


if __name__ == '__main__':
    main()
