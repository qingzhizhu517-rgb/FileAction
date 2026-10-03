import argparse
import asyncio
import sys
from pathlib import Path

import uvicorn

from .api.application import create_app
from .core.config import Settings


PROJECT_ROOT = Path(__file__).resolve().parents[2]


def main():
    parser = argparse.ArgumentParser(description="文启 FileAction 正式服务")
    parser.add_argument("--port", type=int, default=8000)
    parser.add_argument("--no-env-file", action="store_true", help="不读取项目 .env")
    args = parser.parse_args()
    settings = Settings.from_environment(None if args.no_env_file else PROJECT_ROOT / ".env")
    settings.require_core()
    application = create_app(settings)
    if sys.platform == "win32":
        config = uvicorn.Config(application, host="127.0.0.1", port=args.port, access_log=False)
        asyncio.run(uvicorn.Server(config).serve(), loop_factory=asyncio.SelectorEventLoop)
    else:
        uvicorn.run(application, host="127.0.0.1", port=args.port, access_log=False)


if __name__ == "__main__":
    main()
