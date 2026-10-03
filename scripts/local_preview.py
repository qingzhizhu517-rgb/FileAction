"""启动本项目专属的本地预览；不读取根目录 .env，模型与 COS 从受控配置读取，不删除数据卷。

.venv/bin/python scripts/local_preview.py start [--infrastructure-only]
.venv/bin/python scripts/local_preview.py status
.venv/bin/python scripts/local_preview.py stop

凭据只写入被 Git 忽略的 var/local-preview/config.json (0600)。
测试使用同一专属 PostgreSQL 内的独立 fileaction_test 数据库与 Redis DB 1。
API 使用 fileaction_preview 数据库与 Redis DB 0；默认模型与 COS 未配置。
"""
from __future__ import annotations

import argparse
import json
import os
from pathlib import Path
import secrets
import shutil
import signal
import socket
import subprocess
import sys
import time
from urllib.request import urlopen
from uuid import uuid4

ROOT = Path(__file__).resolve().parents[1]
STATE = ROOT / "var" / "local-preview"
CONFIG = STATE / "config.json"
MODEL = STATE / "model.json"
STORAGE = STATE / "storage.env"
PYTHON = ROOT / ".venv" / "bin" / "python"
LABEL = "com.fileaction.local-preview"


def clean_environment():
    result = {key: value for key, value in os.environ.items()
              if not key.startswith(("FILEACTION_", "LANGCHAIN_", "LANGSMITH_"))}
    result.update(PYTHONPATH=str(ROOT / "backend"), LANGCHAIN_TRACING_V2="false", LANGSMITH_TRACING="false")
    return result


def model_environment():
    """从受控文件读取模型配置。不读取 .env，也不继承外部 FILEACTION_* 变量。

    文件缺失即视为未配置模型，返回空映射；凭据只留在被忽略的 var/local-preview/model.json。
    """
    if not MODEL.exists():
        return {}
    if MODEL.is_symlink():
        raise RuntimeError("模型配置路径是符号链接，停止处理。")
    MODEL.chmod(0o600)
    data = json.loads(MODEL.read_text())
    base_url, api_key, name = (data.get(key) for key in ("base_url", "api_key", "model"))
    if not (base_url and api_key and name):
        raise RuntimeError("模型配置不完整：需要 base_url、api_key 与 model 三项。")
    return {
        "FILEACTION_MODEL_BASE_URL": str(base_url),
        "FILEACTION_MODEL_API_KEY": str(api_key),
        "FILEACTION_MODEL_NAME": str(name),
    }


def storage_environment():
    """仅从私密 storage.env 读取 COS 配置；不执行脚本或继承其他服务配置。"""
    if STORAGE.is_symlink():
        raise RuntimeError("云存储配置路径是符号链接，停止处理。")
    if not STORAGE.exists():
        return {}
    STORAGE.chmod(0o600)
    names = ("COS_REGION", "COS_BUCKET", "COS_SECRET_ID", "COS_SECRET_KEY",
             "COS_PREFIX", "COS_SESSION_TOKEN", "COS_SSE_MODE", "COS_OBJECT_MODE")
    values = {}
    for raw in STORAGE.read_text(encoding="utf-8-sig").splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        name, value = line.split("=", 1)
        name, value = name.strip(), value.strip()
        if name not in (*names, "STORAGE_DRIVER"):
            continue
        if len(value) >= 2 and value[0] == value[-1] and value[0] in {"'", '"'}:
            value = value[1:-1]
        values[name] = value
    if values.get("STORAGE_DRIVER") != "cos":
        raise RuntimeError("云存储配置需要 STORAGE_DRIVER=cos。")
    if not all(values.get(name) for name in names[:4]):
        raise RuntimeError("云存储配置不完整：需要地域、存储桶及两项凭据。")
    values.setdefault("COS_PREFIX", "fileaction/")
    values.setdefault("COS_SSE_MODE", "AES256")
    return {"FILEACTION_" + name: values[name] for name in names if values.get(name)}


def run(args, *, environment=None, directory=ROOT, timeout=60, check=True):
    result = subprocess.run(args, cwd=directory, env=environment, timeout=timeout,
                            text=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    if check and result.returncode:
        # 不回显命令参数、环境或异常栈，避免连接凭据进入终端。
        raise RuntimeError(f"本地操作失败（{Path(args[0]).name}，退出码 {result.returncode}）；服务可能未启动或镜像暂不可下载。")
    return result


def docker(*args, **kwargs):
    executable = shutil.which("docker")
    if not executable:
        raise RuntimeError("未找到 Docker，请先启动已安装的 Docker Desktop。")
    return run([executable, *args], **kwargs)


def save(config):
    STATE.mkdir(parents=True, exist_ok=True, mode=0o700)
    STATE.chmod(0o700)
    descriptor = os.open(CONFIG, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(descriptor, "w") as stream:
        json.dump(config, stream, indent=2)
        stream.write("\n")
    CONFIG.chmod(0o600)


def load(create=False):
    if CONFIG.exists():
        if CONFIG.is_symlink():
            raise RuntimeError("配置路径是符号链接，停止处理。")
        CONFIG.chmod(0o600)
        return json.loads(CONFIG.read_text())
    if not create:
        return None
    identifier = uuid4().hex[:10]
    config = {
        "version": 1, "instance": identifier, "root": str(ROOT),
        "containers": {kind: f"fileaction-local-preview-{kind}-{identifier}" for kind in ("pg", "redis")},
        "volumes": {kind: f"fileaction-local-preview-{kind}-data-{identifier}" for kind in ("pg", "redis")},
        "credentials": {kind: secrets.token_urlsafe(32) for kind in ("admin", "runtime", "auth", "dispatcher", "redis", "app")},
    }
    save(config)
    return config


def inspect_container(config, kind):
    result = docker("inspect", config["containers"][kind], check=False, timeout=10)
    if result.returncode:
        return None
    item = json.loads(result.stdout)[0]
    if item["Config"].get("Labels", {}).get(LABEL) != config["instance"]:
        raise RuntimeError("容器归属不匹配，未操作该容器。")
    return item


def ensure_container(config, kind):
    name = config["containers"][kind]
    existing = inspect_container(config, kind)
    if existing:
        if not existing["State"]["Running"]:
            docker("start", name)
    else:
        image, port, destination = (
            ("pgvector/pgvector:pg17", 5432, "/var/lib/postgresql/data") if kind == "pg" else
            ("redis:7.4-alpine", 6379, "/data")
        )
        image_check = docker("image", "inspect", image, check=False)
        if image_check.returncode:
            print(f"正在下载本地依赖镜像：{image}", flush=True)
            pulled = docker("pull", image, timeout=300, check=False)
            if pulled.returncode:
                # 镜像名称固定且无凭据；保留 Docker 给出的真实下载错误。
                print(pulled.stderr.strip()[-1200:], file=sys.stderr)
                raise RuntimeError("依赖镜像下载失败；未修改系统镜像设置。")
        volume = config["volumes"][kind]
        volume_check = docker("volume", "inspect", volume, check=False)
        if not volume_check.returncode:
            labels = json.loads(volume_check.stdout)[0].get("Labels") or {}
            if labels.get(LABEL) != config["instance"]:
                raise RuntimeError("数据卷归属不匹配，未操作该数据卷。")
        else:
            docker("volume", "create", "--label", f"{LABEL}={config['instance']}", volume)
        args = ["run", "--detach", "--name", name, "--label", f"{LABEL}={config['instance']}",
                "--publish", f"127.0.0.1::{port}", "--volume", f"{volume}:{destination}"]
        environment = clean_environment()
        if kind == "pg":
            environment["POSTGRES_PASSWORD"] = config["credentials"]["admin"]
            args += ["--env", "POSTGRES_PASSWORD", "--env", "POSTGRES_DB=fileaction_preview", image]
        else:
            environment["REDIS_PASSWORD"] = config["credentials"]["redis"]
            args += ["--env", "REDIS_PASSWORD", image, "sh", "-c",
                     'exec redis-server --appendonly yes --maxmemory 256mb --maxmemory-policy noeviction --requirepass "$REDIS_PASSWORD"']
        docker(*args, environment=environment)
    container_port = "5432/tcp" if kind == "pg" else "6379/tcp"
    port = docker("port", name, container_port).stdout.strip().rsplit(":", 1)[1]
    return int(port)


def configure_urls(config, pg_port, redis_port):
    credentials = config["credentials"]
    def database(role, password, name, sqlalchemy=True):
        scheme = "postgresql+psycopg" if sqlalchemy else "postgresql"
        return f"{scheme}://{role}:{password}@127.0.0.1:{pg_port}/{name}"
    common = {
        "FILEACTION_ENV": "development", "FILEACTION_APP_SECRET": credentials["app"],
        "FILEACTION_REGISTRATION_ENABLED": "true", "FILEACTION_ALLOWED_ORIGINS": "http://127.0.0.1:8785",
        "FILEACTION_EMBEDDING_DIMENSIONS": "768",
    }
    migrations = {}
    for database_name, key, redis_db in (("fileaction_preview", "environment", 0), ("fileaction_test", "test_environment", 1)):
        environment = {**common,
            "FILEACTION_DATABASE_URL": database("fileaction_app", credentials["runtime"], database_name),
            "FILEACTION_AUTH_DATABASE_URL": database("fileaction_auth_login", credentials["auth"], database_name),
            "FILEACTION_DISPATCHER_DATABASE_URL": database("fileaction_dispatch_login", credentials["dispatcher"], database_name),
            "FILEACTION_REDIS_URL": f"redis://:{credentials['redis']}@127.0.0.1:{redis_port}/{redis_db}",
        }
        admin = database("postgres", credentials["admin"], database_name, sqlalchemy=False)
        if key == "test_environment":
            environment["FILEACTION_ENV"] = "test"
            environment.update({
                "FILEACTION_TEST_DATABASE_URL": environment["FILEACTION_DATABASE_URL"],
                "FILEACTION_TEST_AUTH_DATABASE_URL": environment["FILEACTION_AUTH_DATABASE_URL"],
                "FILEACTION_TEST_ADMIN_DATABASE_URL": admin,
                "FILEACTION_TEST_DISPATCHER_DATABASE_URL": environment["FILEACTION_DISPATCHER_DATABASE_URL"],
                "FILEACTION_TEST_REDIS_URL": environment["FILEACTION_REDIS_URL"],
            })
        config[key] = environment
        migrations[database_name] = {
            "FILEACTION_MIGRATION_DATABASE_URL": admin.replace("postgresql://", "postgresql+psycopg://", 1),
            "FILEACTION_RUNTIME_PASSWORD": credentials["runtime"],
            "FILEACTION_AUTH_PASSWORD": credentials["auth"],
            "FILEACTION_DISPATCHER_PASSWORD": credentials["dispatcher"],
        }
    config["migration_environments"] = migrations
    config["ports"] = {"pg": pg_port, "redis": redis_port}
    config["schema_embedding_dimensions"] = "768 is a local schema fixture; no embedding model configured"
    save(config)


def wait_database(config):
    import psycopg
    dsn = config["migration_environments"]["fileaction_preview"]["FILEACTION_MIGRATION_DATABASE_URL"].replace("postgresql+psycopg://", "postgresql://", 1)
    deadline = time.monotonic() + 45
    while True:
        try:
            with psycopg.connect(dsn, connect_timeout=1, autocommit=True) as connection:
                if not connection.execute("SELECT 1 FROM pg_database WHERE datname='fileaction_test'").fetchone():
                    connection.execute("CREATE DATABASE fileaction_test")
            break
        except psycopg.OperationalError:
            if time.monotonic() >= deadline:
                raise RuntimeError("本次专属 PostgreSQL 未及时就绪。") from None
            time.sleep(.3)
    from redis import Redis
    with Redis.from_url(config["environment"]["FILEACTION_REDIS_URL"], socket_timeout=2) as redis:
        if not redis.ping():
            raise RuntimeError("本次专属 Redis 未就绪。")


def migrate(config):
    for name, values in config["migration_environments"].items():
        environment = {**clean_environment(), **values}
        migration = run([str(PYTHON), "-m", "alembic", "-x", "embedding_dimensions=768", "upgrade", "head"],
            environment=environment, directory=ROOT / "backend", check=False)
        if migration.returncode:
            descriptor = os.open(STATE / "migration.log", os.O_WRONLY | os.O_CREAT | os.O_APPEND, 0o600)
            with os.fdopen(descriptor, "a") as log:
                log.write(migration.stdout + migration.stderr)
            raise RuntimeError("数据库迁移未通过；本机详情见 var/local-preview/migration.log，数据库和配置已保留。")
        run([str(PYTHON), "-m", "fileaction.db.bootstrap"], environment=environment, directory=ROOT / "backend")
        print(f"数据库迁移与受限角色已就绪：{name}", flush=True)
    config["migrated_at"] = time.strftime("%Y-%m-%dT%H:%M:%S%z")
    save(config)


def normalize_signature(value):
    # macOS Python 启动后会展开可执行路径；保留启动时间和完整应用参数。
    parts = value.split(None, 6)
    return " ".join(parts[:5]) + " " + parts[6] if len(parts) == 7 else value


def process_signature(pid):
    result = run(["ps", "-p", str(pid), "-o", "lstart=", "-o", "command="], check=False)
    return result.stdout.strip() if not result.returncode else ""


def process_running(config, name):
    process = config.get(name, {})
    saved = process.get("signature", "")
    current = process_signature(process.get("pid")) if process.get("pid") else ""
    return bool(saved and current and normalize_signature(current) == normalize_signature(saved))


def api_running(config):
    return process_running(config, "api")


def worker_running(config):
    return process_running(config, "worker")


def start_process(config, name, argv, environment, log_name):
    log = STATE / log_name
    descriptor = os.open(log, os.O_WRONLY | os.O_CREAT | os.O_APPEND, 0o600)
    with os.fdopen(descriptor, "a") as output:
        process = subprocess.Popen([str(PYTHON), *argv],
            cwd=ROOT / "backend", env=environment, stdin=subprocess.DEVNULL,
            stdout=output, stderr=output, start_new_session=True)
    config[name] = {"pid": process.pid, "signature": process_signature(process.pid)}
    save(config)
    return process


def start_api(config, port):
    if api_running(config):
        print(f"API 已在运行：http://127.0.0.1:{config['api']['port']}", flush=True)
        return
    with socket.socket() as probe:
        # Match the API server's bind policy: TIME_WAIT after a clean shutdown
        # is reusable, while another live listener must still block startup.
        probe.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        try:
            probe.bind(("127.0.0.1", port))
        except OSError:
            raise RuntimeError(f"端口 {port} 已被占用；请选择 --port，不会停止现有服务。") from None
    environment = {**clean_environment(), **config["environment"], **model_environment(), **storage_environment()}
    environment.pop("FILEACTION_DISPATCHER_DATABASE_URL", None)
    process = start_process(config, "api", ["-m", "fileaction", "--no-env-file", "--port", str(port)], environment, "api.log")
    config["api"]["port"] = port
    save(config)
    deadline = time.monotonic() + 30
    while time.monotonic() < deadline:
        if process.poll() is not None:
            raise RuntimeError("API 提前退出；请在本机检查 var/local-preview/api.log。")
        try:
            with urlopen(f"http://127.0.0.1:{port}/api/v1/health/live", timeout=1) as response:
                if response.status == 200:
                    storage_status = "已配置" if storage_environment() else "未配置"
                    print(f"API 已启动：http://127.0.0.1:{port}（云存储{storage_status}；连接状态见就绪检查）", flush=True)
                    return
        except OSError:
            time.sleep(.2)
    raise RuntimeError("API 未及时就绪；请在本机检查 var/local-preview/api.log。")


def start_worker(config):
    """启动独立生成 Worker；它需要受限 dispatcher 连接与模型配置，缺一不可。"""
    if worker_running(config):
        print("生成处理进程已在运行。", flush=True)
        return
    if not model_environment():
        # Worker 启动时就会构造模型网关，未配置模型会直接以 MODEL_NOT_CONFIGURED 退出。
        raise RuntimeError(
            f"生成处理进程需要模型配置：请在 {MODEL} 写入 base_url、api_key 与 model 后重试。"
        )
    environment = {**clean_environment(), **config["environment"], **model_environment(), **storage_environment()}
    process = start_process(config, "worker", ["-m", "fileaction.workers"], environment, "worker.log")
    deadline = time.monotonic() + 15
    while time.monotonic() < deadline:
        if process.poll() is not None:
            raise RuntimeError("生成处理进程提前退出；请在本机检查 var/local-preview/worker.log。")
        time.sleep(.4)
        if process.poll() is None:
            print("生成处理进程已启动：python -m fileaction.workers", flush=True)
            return
    raise RuntimeError("生成处理进程未就绪；请在本机检查 var/local-preview/worker.log。")

def stop_process(config, name, message):
    if not process_running(config, name):
        config.pop(name, None)
        save(config)
        return
    pid = config[name]["pid"]
    os.kill(pid, signal.SIGTERM)
    deadline = time.monotonic() + 8
    while time.monotonic() < deadline and process_running(config, name):
        time.sleep(.2)
    if process_running(config, name):
        raise RuntimeError(f"{message}尚未结束，未强制终止；请检查本地日志。")
    config.pop(name, None)
    save(config)


def stop(config):
    stop_process(config, "worker", "生成处理进程")
    stop_process(config, "api", "API")
    for kind in ("redis", "pg"):
        item = inspect_container(config, kind)
        if item and item["State"]["Running"]:
            docker("stop", "--time", "5", config["containers"][kind])
    print("本次预览服务已停止；数据卷与配置已保留。")


def status(config):
    if not config:
        print("尚未创建本地预览环境。")
        return
    result = {"config": str(CONFIG), "model_configured": bool(model_environment()),
              "model_config_file": str(MODEL) if MODEL.exists() else None,
              "storage_configured": bool(storage_environment()),
              "storage_config_file": str(STORAGE) if STORAGE.exists() else None,
              "api_running": api_running(config), "worker_running": worker_running(config),
              "api_url": f"http://127.0.0.1:{config['api']['port']}" if config.get("api") else None,
              "containers": {}, "volumes_preserved": list(config["volumes"].values())}
    engine = docker("info", "--format", "{{.ServerVersion}}", check=False, timeout=10)
    if engine.returncode:
        result["containers"] = {"pg": "engine_unavailable", "redis": "engine_unavailable"}
        print(json.dumps(result, ensure_ascii=False, indent=2))
        return
    for kind in ("pg", "redis"):
        try:
            item = inspect_container(config, kind)
            result["containers"][kind] = "running" if item and item["State"]["Running"] else "stopped"
        except (OSError, RuntimeError, subprocess.TimeoutExpired):
            result["containers"][kind] = "unavailable"
    print(json.dumps(result, ensure_ascii=False, indent=2))


def main():
    parser = argparse.ArgumentParser(description="隔离的本地 FileAction 预览；不读取 .env，不自动删除数据。")
    parser.add_argument("command", choices=("start", "stop", "status"))
    parser.add_argument("--infrastructure-only", action="store_true", help="仅启动数据库/缓存并迁移，不启动 API")
    parser.add_argument("--port", type=int, default=18800, help="API 本地端口，默认 18800")
    parser.add_argument("--no-worker", action="store_true", help="启动 API 但不启动生成处理进程")
    args = parser.parse_args()
    config = load(create=args.command == "start")
    if config and config.get("root") != str(ROOT):
        raise RuntimeError("配置属于其他工作目录；未操作其服务。")
    if args.command == "status":
        status(config)
    elif args.command == "stop":
        stop(config) if config else print("尚未创建本地预览环境。")
    else:
        if not PYTHON.is_file():
            raise RuntimeError("请先为 backend 安装 .venv 依赖。")
        docker("info", "--format", "{{.ServerVersion}}", timeout=10)
        pg_port = ensure_container(config, "pg")
        redis_port = ensure_container(config, "redis")
        configure_urls(config, pg_port, redis_port)
        wait_database(config)
        migrate(config)
        print(f"本地配置已就绪：{CONFIG}（包含凭据，请勿分享）", flush=True)
        if not args.infrastructure_only:
            start_api(config, args.port)
            if not args.no_worker:
                start_worker(config)


if __name__ == "__main__":
    try:
        main()
    except (OSError, RuntimeError, subprocess.SubprocessError) as error:
        # 只输出本工具自己的错误；外部错误可能含连接参数。
        print(str(error) if isinstance(error, RuntimeError) else "本地预览操作失败，请检查 Docker 和项目依赖。", file=sys.stderr)
        raise SystemExit(1)
