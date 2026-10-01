"""程序合成配乐：氛围和弦铺底 + 轻拍 + 场景转场音效，不使用任何外部素材。"""
import json
import wave
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parent.parent
BUILD = ROOT / "build"
SR = 48000
tl = json.loads((BUILD / "timeline.json").read_text(encoding="utf-8"))
T = tl["total"] + 1.0
n = int(SR * T)
t = np.arange(n) / SR
out = np.zeros(n)

def midi(m): return 440.0 * 2 ** ((m - 69) / 12)

# 和弦进行：Am9 - Fmaj7 - C - G6，每 4 拍一换，BPM 96
BPM = 96
beat = 60 / BPM
chords = [[57, 60, 64, 67, 71], [53, 57, 60, 64, 69], [48, 55, 60, 64, 67], [55, 59, 62, 64, 71]]
bar = beat * 4
for i in range(int(T / bar) + 1):
    s0 = i * bar
    a, b = int(s0 * SR), min(n, int((s0 + bar + 1.2) * SR))
    if a >= n: break
    tt = t[a:b] - s0
    env = np.minimum(1, tt / 1.0) * np.clip((bar + 1.2 - tt) / 1.2, 0, 1)
    for m in chords[i % 4]:
        f = midi(m)
        tone = np.sin(2 * np.pi * f * tt) + 0.5 * np.sin(2 * np.pi * f * 1.003 * tt) + 0.25 * np.sin(2 * np.pi * f * 2 * tt)
        out[a:b] += 0.018 * env * tone
    # 低音
    f = midi(chords[i % 4][0] - 12)
    out[a:b] += 0.05 * env * np.sin(2 * np.pi * f * tt)

# 轻拍：柔和底鼓 + 细碎高频，第 2 场景后进入
start_beat = tl["scenes"][1]["start"]
k = 0
while True:
    s0 = start_beat + k * beat
    if s0 > T - 4: break
    a = int(s0 * SR); L = int(0.35 * SR)
    tt = np.arange(min(L, n - a)) / SR
    if k % 2 == 0:
        freq = 110 * np.exp(-tt * 18) + 45
        out[a:a + len(tt)] += 0.10 * np.sin(2 * np.pi * np.cumsum(freq) / SR) * np.exp(-tt * 9)
    hh = np.random.default_rng(k).standard_normal(len(tt)) * np.exp(-tt * 70)
    out[a:a + len(tt)] += 0.012 * np.diff(np.concatenate([[0], hh]))
    k += 1

# 转场“嗖”声与提示音
rng = np.random.default_rng(1)
for sc in tl["scenes"][1:]:
    c = sc["start"]; a = int((c - 0.6) * SR); L = int(0.9 * SR)
    if a < 0 or a + L > n: continue
    tt = np.arange(L) / SR
    noise = rng.standard_normal(L)
    # 简单一阶低通扫频
    alpha = np.linspace(0.02, 0.35, L)
    y = np.zeros(L); acc = 0.0
    for j in range(L):
        acc += alpha[j] * (noise[j] - acc); y[j] = acc
    env = np.sin(np.pi * tt / 0.9) ** 2
    out[a:a + L] += 0.10 * y * env
    b = int(c * SR); L2 = int(0.6 * SR)
    tt2 = np.arange(min(L2, n - b)) / SR
    out[b:b + len(tt2)] += 0.035 * np.sin(2 * np.pi * midi(88) * tt2) * np.exp(-tt2 * 7)

# 淡入淡出与限幅
fade = np.minimum(1, t / 2.0) * np.clip((T - t) / 3.0, 0, 1)
out *= fade
out = np.tanh(out * 1.6) / 1.6
out /= max(1e-6, np.abs(out).max()) / 0.8
stereo = np.stack([out, np.roll(out, int(0.012 * SR))], axis=1)
with wave.open(str(BUILD / "music.wav"), "wb") as w:
    w.setnchannels(2); w.setsampwidth(2); w.setframerate(SR)
    w.writeframes((stereo * 32767).astype(np.int16).tobytes())
print("配乐已生成", round(T, 2), "s")
