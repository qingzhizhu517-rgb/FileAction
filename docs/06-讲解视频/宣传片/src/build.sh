#!/bin/sh
# 一键生成：逐帧渲染 → 合成配乐 → 封装 MP4（H.264 + AAC）
set -e
cd "$(dirname "$0")/.."
rm -rf build/frames
node src/capture.mjs --workers "${WORKERS:-6}"
python3 src/music.py
mkdir -p output
ffmpeg -y -v error -framerate 30 -i build/frames/f%05d.jpg -i build/music.wav \
  -af "loudnorm=I=-16:TP=-1.5:LRA=11" -ar 48000 \
  -c:v libx264 -preset slow -crf 18 -pix_fmt yuv420p -movflags +faststart \
  -c:a aac -b:a 192k -shortest "output/文启-概念宣传片.mp4"
echo "输出：output/文启-概念宣传片.mp4"
