#!/bin/sh
# 混音（配音按时间轴放置 + 配乐随配音自动压低）并与帧序列合成 MP4
set -e
cd "$(dirname "$0")/.."
B=build
TOTAL=$(python3 -c "import json;print(json.load(open('$B/timeline.json'))['total'])")

# 1. 把每段配音放到对应时间点，合成一条人声轨
python3 - <<'EOF'
import json, subprocess
tl = json.load(open('build/timeline.json'))
inputs, filters = [], []
for i, s in enumerate(tl['scenes']):
    inputs += ['-i', f"build/audio/{s['id']}.aiff"]
    ms = int(s['narrStart'] * 1000)
    filters.append(f"[{i}:a]aresample=48000,aformat=channel_layouts=stereo,adelay={ms}|{ms},volume=1.6[a{i}]")
mix = ''.join(f'[a{i}]' for i in range(len(tl['scenes'])))
filters.append(f"{mix}amix=inputs={len(tl['scenes'])}:normalize=0,apad=whole_dur={tl['total'] + 1}[v]")
subprocess.run(['ffmpeg', '-y', '-v', 'error', *inputs, '-filter_complex', ';'.join(filters), '-map', '[v]', 'build/voice.wav'], check=True)
EOF

# 2. 配乐侧链压缩后与人声混合
ffmpeg -y -v error -i $B/voice.wav -i $B/music.wav -filter_complex \
  "[1:a]volume=0.22[m];[0:a]asplit=2[v1][v2];[m][v1]sidechaincompress=threshold=0.03:ratio=6:attack=20:release=400[md];[v2][md]amix=inputs=2:normalize=0,loudnorm=I=-16:TP=-1.5:LRA=11[out]" \
  -map "[out]" -ar 48000 $B/mix.wav

# 3. 帧序列 + 混音 → MP4
mkdir -p output
ffmpeg -y -v error -framerate 30 -i $B/frames/f%05d.jpg -i $B/mix.wav \
  -c:v libx264 -preset slow -crf 18 -pix_fmt yuv420p -movflags +faststart \
  -c:a aac -b:a 192k -t "$TOTAL" "output/DoAgent-讲解视频.mp4"
echo "输出：output/DoAgent-讲解视频.mp4"
