"""独立Docker合成验收；真实API/Worker，模型为显式本机HTTP替身。

不读取.env、不操作既有服务；仅停止本脚本创建的进程与临时容器。
"""
from __future__ import annotations

import json
import argparse
import os
from pathlib import Path
import shutil
import socket
import subprocess
import sys
import time
from urllib.request import urlopen
from uuid import uuid4

ROOT = Path(__file__).resolve().parents[2]
FLAGS = subprocess.CREATE_NO_WINDOW if sys.platform == 'win32' else 0


def command(arguments: list[str], *, environment=None, directory=ROOT, capture=False):
    return subprocess.run(arguments, cwd=directory, env=environment, check=True,
                          creationflags=FLAGS, text=True, encoding='utf-8', errors='replace',
                          stdout=subprocess.PIPE if capture else None,
                          stderr=subprocess.PIPE if capture else None)


def free_port():
    with socket.socket() as probe:
        probe.bind(('127.0.0.1', 0))
        return probe.getsockname()[1]


def wait_http(url: str, processes):
    deadline = time.monotonic() + 30
    while time.monotonic() < deadline:
        if any(process.poll() is not None for process in processes):
            raise RuntimeError('本次验收子进程提前退出，请检查输出日志')
        try:
            with urlopen(url, timeout=1) as response:
                if response.status == 200:
                    return
        except (OSError, TimeoutError):
            time.sleep(.2)
    raise RuntimeError('本次验收服务未及时就绪')


def main(*, hybrid=False):
    docker = shutil.which('docker.exe' if sys.platform == 'win32' else 'docker')
    node = shutil.which('node.exe' if sys.platform == 'win32' else 'node')
    if not docker or not node:
        raise RuntimeError('本验收需要本机Docker和Node.js；不会安装系统服务')
    command([docker, 'info', '--format', '{{.ServerVersion}}'], capture=True)
    suffix = uuid4().hex[:12]
    containers: list[str] = []
    processes: list[subprocess.Popen] = []
    cleanup_errors: list[str] = []
    environment = {key: value for key, value in os.environ.items()
                   if not key.startswith(('FILEACTION_', 'LANGCHAIN_', 'LANGSMITH_'))}
    environment.update(LANGCHAIN_TRACING_V2='false', LANGSMITH_TRACING='false')
    api_port, model_port, front_port = free_port(), free_port(), free_port()
    if len({api_port, model_port, front_port}) != 3:
        raise RuntimeError('本次验收端口分配发生冲突，请重新运行')
    try:
        for kind, image, container_port, arguments in (
            ('pg', 'pgvector/pgvector:pg17', 5432,
             ['-e', 'POSTGRES_DB=fileaction_test', '-e', 'POSTGRES_PASSWORD=synthetic-e2e-admin-only']),
            ('redis', 'redis:7.4-alpine', 6379, []),
        ):
            name = f'fileaction-generation-e2e-{kind}-{suffix}'
            args = [docker, 'run', '--detach', '--rm', '--name', name,
                    '-p', f'127.0.0.1::{container_port}', *arguments, image]
            if kind == 'redis':
                args += ['redis-server', '--save', '', '--appendonly', 'no',
                         '--maxmemory', '128mb', '--maxmemory-policy', 'noeviction',
                         '--requirepass', 'synthetic-e2e-redis-only']
            command(args, capture=True)
            containers.append(name)
            port = int(command([docker, 'port', name, f'{container_port}/tcp'], capture=True).stdout.strip().rsplit(':', 1)[1])
            if kind == 'pg':
                database_port = port
            else:
                redis_port = port
        admin_url = f'postgresql://postgres:synthetic-e2e-admin-only@127.0.0.1:{database_port}/fileaction_test'
        import psycopg
        deadline = time.monotonic() + 45
        while True:
            try:
                with psycopg.connect(admin_url, connect_timeout=1) as connection:
                    connection.execute('SELECT 1')
                break
            except psycopg.OperationalError:
                if time.monotonic() >= deadline:
                    raise RuntimeError('本次专属合成PostgreSQL未就绪') from None
                time.sleep(.3)
        environment.update({
            'PYTHONPATH': str(ROOT / 'backend'),
            'FILEACTION_ENV': 'test',
            'FILEACTION_MIGRATION_DATABASE_URL': admin_url.replace('postgresql://', 'postgresql+psycopg://', 1),
            'FILEACTION_RUNTIME_PASSWORD': 'synthetic-e2e-runtime-only',
            'FILEACTION_AUTH_PASSWORD': 'synthetic-e2e-auth-only',
            'FILEACTION_DISPATCHER_PASSWORD': 'synthetic-e2e-dispatch-only',
            'FILEACTION_DATABASE_URL': f'postgresql+psycopg://fileaction_app:synthetic-e2e-runtime-only@127.0.0.1:{database_port}/fileaction_test',
            'FILEACTION_AUTH_DATABASE_URL': f'postgresql+psycopg://fileaction_auth_login:synthetic-e2e-auth-only@127.0.0.1:{database_port}/fileaction_test',
            'FILEACTION_DISPATCHER_DATABASE_URL': f'postgresql+psycopg://fileaction_dispatch_login:synthetic-e2e-dispatch-only@127.0.0.1:{database_port}/fileaction_test',
            'FILEACTION_REDIS_URL': f'redis://:synthetic-e2e-redis-only@127.0.0.1:{redis_port}/0',
            'FILEACTION_APP_SECRET': 'synthetic-isolated-e2e-application-secret-only',
            'FILEACTION_REGISTRATION_ENABLED': 'true',
            'FILEACTION_EMBEDDING_DIMENSIONS': '768',
            'FILEACTION_MODEL_BASE_URL': f'http://127.0.0.1:{model_port}/v1',
            'FILEACTION_MODEL_NAME': 'synthetic-http-test-only',
            'FILEACTION_MODEL_API_KEY': 'synthetic-local-only',
            'FILEACTION_ALLOWED_ORIGINS': f'http://127.0.0.1:{front_port}',
            'FILEACTION_DEV_API_TARGET': f'http://127.0.0.1:{api_port}',
            'FILEACTION_E2E_BASE_URL': f'http://127.0.0.1:{front_port}',
            'FILEACTION_SYNTHETIC_HTTP_GATEWAY': '1',
            'FILEACTION_SYNTHETIC_DELAY_SECONDS': '2',
        })
        if hybrid:
            environment.update({
                'FILEACTION_EMBEDDING_BASE_URL': 'https://synthetic.invalid/v1',
                'FILEACTION_EMBEDDING_API_KEY': 'synthetic-embedding-local-only',
                'FILEACTION_EMBEDDING_MODEL': 'synthetic-embedding-only',
                'FILEACTION_EMBEDDING_PROFILE_VERSION': '1',
                'FILEACTION_SYNTHETIC_EMBEDDING_TARGET': f'http://127.0.0.1:{model_port}',
            })
        # 768 dimensions is a synthetic migration fixture, not a model choice.
        command([sys.executable, '-m', 'alembic', '-x', 'embedding_dimensions=768', 'upgrade', 'head'],
                environment=environment, directory=ROOT / 'backend')
        command([sys.executable, '-m', 'fileaction.db.bootstrap'], environment=environment, directory=ROOT / 'backend')
        app_environment = {key: value for key, value in environment.items()
                           if key not in {'FILEACTION_MIGRATION_DATABASE_URL', 'FILEACTION_RUNTIME_PASSWORD',
                                          'FILEACTION_AUTH_PASSWORD', 'FILEACTION_DISPATCHER_PASSWORD'}}
        launches = [
            ([sys.executable, 'tests/support/synthetic_generation_server.py', '--port', str(model_port)], ROOT / 'backend'),
            ([sys.executable, '-m', 'fileaction', '--no-env-file', '--port', str(api_port)], ROOT / 'backend'),
            ([sys.executable, 'tests/support/synthetic_embedding_worker.py', 'generation'] if hybrid else
             [sys.executable, '-m', 'fileaction.workers'], ROOT / 'backend'),
            ([node, 'node_modules/vite/bin/vite.js', '--host', '127.0.0.1', '--port', str(front_port), '--strictPort'], ROOT / 'front'),
        ]
        if hybrid:
            launches.append(([sys.executable, 'tests/support/synthetic_embedding_worker.py', 'indexing'], ROOT / 'backend'))
        for args, directory in launches:
            processes.append(subprocess.Popen(args, cwd=directory, env=app_environment, creationflags=FLAGS))
        for url in (f'http://127.0.0.1:{model_port}/health',
                    f'http://127.0.0.1:{api_port}/api/v1/health/live',
                    f'http://127.0.0.1:{front_port}/'):
            wait_http(url, processes)
        result = subprocess.run([node, 'node_modules/@playwright/test/cli.js', 'test',
                                 '--config', 'playwright.hybrid.config.ts' if hybrid else 'playwright.generation.config.ts'],
                                cwd=ROOT / 'front', env=app_environment, creationflags=FLAGS,
                                stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                                text=True, encoding='utf-8', errors='replace')
        print(result.stdout, flush=True)
        print(json.dumps({'synthetic_http_model_only': True, 'isolated_infrastructure': True,
                          'synthetic_embedding_transport': hybrid,
                          'exit_code': result.returncode}))
        return result.returncode
    finally:
        for process in reversed(processes):
            try:
                if process.poll() is None:
                    if sys.platform == 'win32':
                        # Only a process tree this invocation started. No name kills.
                        subprocess.run(['taskkill', '/PID', str(process.pid), '/T', '/F'],
                                       stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, creationflags=FLAGS)
                    else:
                        process.terminate()
                    try:
                        process.wait(timeout=5)
                    except subprocess.TimeoutExpired:
                        process.kill()
                        process.wait(timeout=5)
            except (OSError, subprocess.SubprocessError):
                cleanup_errors.append(f'process:{process.pid}')
        for name in reversed(containers):
            try:
                command([docker, 'stop', '--time', '3', name], capture=True)
            except (OSError, subprocess.SubprocessError):
                cleanup_errors.append(f'container:{name}')
        if cleanup_errors:
            raise RuntimeError('本次验收资源清理不完整：' + ', '.join(cleanup_errors))


if __name__ == '__main__':
    if hasattr(sys.stdout, 'reconfigure'):
        sys.stdout.reconfigure(encoding='utf-8', errors='replace')
    parser = argparse.ArgumentParser(description='独立Docker合成工程验收，不读取真实.env')
    parser.add_argument('--hybrid', action='store_true', help='使用本机Embedding传输替身验证索引与hybrid链路')
    raise SystemExit(main(hybrid=parser.parse_args().hybrid))
