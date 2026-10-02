#!/bin/sh
# 云端神经语音配音：edge-tts（微软中文神经语音），只上传旁白文本。
# 用法：sh src/tts.sh [语音名]，默认 zh-CN-XiaoxiaoNeural
set -e
cd "$(dirname "$0")/.."
VOICE="${1:-zh-CN-XiaoxiaoNeural}"
mkdir -p build/audio
rm -f build/audio/*.aiff
while IFS="$(printf '\t')" read -r id text; do
  [ -z "$id" ] && continue
  edge-tts -v "$VOICE" --rate=-4% --pitch=-2Hz -t "$text" --write-media "build/audio/$id.mp3"
  echo "$id ok"
done < build/narration.tsv
