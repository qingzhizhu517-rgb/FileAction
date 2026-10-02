#!/bin/zsh
DEMO_DIR="${0:A:h}"
python3 "$DEMO_DIR/serve.py"
if [[ $? -ne 0 ]]; then
  read '?按回车关闭窗口。'
fi
