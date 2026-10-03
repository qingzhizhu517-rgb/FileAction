#!/bin/sh
# 从任何目录启动本机服务，优先使用项目虚拟环境。
set -eu
TASK_ROOT=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
cd "$TASK_ROOT"
if [ -x "$TASK_ROOT/.venv/bin/python" ]; then
  exec "$TASK_ROOT/.venv/bin/python" -m src.server "$@"
fi
exec python3 -m src.server "$@"
