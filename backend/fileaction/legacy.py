"""旧本机MVP入口；正式服务使用 fileaction.api.application 工厂。"""

import argparse
import os
from pathlib import Path

import uvicorn
from dotenv import dotenv_values

PROJECT_ROOT = Path(__file__).resolve().parents[2]
MODEL_ENV_KEYS = ("FILEACTION_MODEL_BASE_URL", "FILEACTION_MODEL_API_KEY", "FILEACTION_MODEL_NAME")


def main():
    parser = argparse.ArgumentParser(description="文启本机个人 MVP（旧入口）")
    parser.add_argument("--port", type=int, default=8766)
    parser.add_argument("--no-env-file", action="store_true", help="不读取项目 .env")
    args = parser.parse_args()
    if not args.no_env_file:
        values = dotenv_values(PROJECT_ROOT / ".env", encoding="utf-8-sig", interpolate=False)
        for key in MODEL_ENV_KEYS:
            if values.get(key) is not None:
                os.environ.setdefault(key, values[key])
    uvicorn.run("fileaction.app:app", host="127.0.0.1", port=args.port, access_log=False)


if __name__ == "__main__":
    main()
