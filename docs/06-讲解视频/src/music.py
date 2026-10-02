"""程序合成配乐：安静的钢琴式分解和弦 + 低垫音，无鼓点、无转场音效，不使用外部素材。"""
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
rng = np.random.default_rng(3)


def midi(m):
    return 440.0 * 2 ** ((m - 69) / 12)


def piano(f, dur, vel):
    """加法合成的柔和钢琴音：多泛音、高次衰减更快，起音带轻微敲击。"""
    L = int(dur * SR)
    tt = np.arange(L) / SR
    y = np.zeros(L)
    for k, a in enumerate([1.0, 0.42, 0.18, 0.09, 0.04], start=1):
        detune = 1 + 0.0004 * k * k  # 轻微非谐性
        y += a * np.sin(2 * np.pi * f * k * detune * tt) * np.exp(-tt * (1.1 + 0.9 * k))
    attack = np.minimum(1, tt / 0.006)
    return vel * y * attack


# 和弦进行：Fmaj9 - Am7 - Dm9 - Bbmaj7（F 大调，温和不煽情），BPM 72
BPM = 72
beat = 60 / BPM
bar = beat * 4
prog = [
    [41, 53, 57, 60, 64, 67],  # Fmaj9
    [45, 52, 57, 60, 64, 67],  # Am7
    [38, 53, 57, 60, 62, 64],  # Dm9
    [46, 53, 57, 62, 65, 69],  # Bbmaj7
]
pattern = [(0, 1), (1, 3), (1.5, 4), (2, 2), (3, 5), (3.5, 3)]  # (拍位, 和弦音序号)
start = 0.6
i = 0
while True:
    s0 = start + i * bar
    if s0 > T - 6:
        break
    ch = prog[i % 4]
    # 低音
    a = int(s0 * SR)
    note = piano(midi(ch[0]), bar + 1.5, 0.11)
    m = min(len(note), n - a)
    out[a:a + m] += note[:m]
    for bpos, idx in pattern:
        st = s0 + bpos * beat + rng.uniform(-0.012, 0.012)
        a = int(st * SR)
        note = piano(midi(ch[idx]), 3.2, 0.05 * rng.uniform(0.8, 1.05))
        m = min(len(note), n - a)
        if m > 0:
            out[a:a + m] += note[:m]
    i += 1

# 低垫音：两个八度的正弦，缓慢呼吸
pad_f = midi(41)
out += 0.012 * (np.sin(2 * np.pi * pad_f * t) + 0.5 * np.sin(2 * np.pi * pad_f * 2 * t)) * (0.6 + 0.4 * np.sin(2 * np.pi * t / 9))

# 简易混响：几条衰减延迟
wet = np.zeros(n)
for d, g in [(0.031, 0.35), (0.053, 0.28), (0.089, 0.22), (0.137, 0.16), (0.211, 0.11)]:
    k = int(d * SR)
    wet[k:] += g * out[:-k]
out = out + 0.6 * wet

# 结尾留一个落地的主和弦
end = tl["scenes"][-1]["start"] + 0.2
for m_ in [41, 53, 57, 60, 64]:
    a = int(end * SR)
    note = piano(midi(m_), 6, 0.07)
    m = min(len(note), n - a)
    out[a:a + m] += note[:m]

fade = np.minimum(1, t / 2.5) * np.clip((T - t) / 3.5, 0, 1)
out *= fade
out = np.tanh(out * 1.3) / 1.3
out /= max(1e-6, np.abs(out).max()) / 0.7
stereo = np.stack([out, np.roll(out, int(0.009 * SR))], axis=1)
with wave.open(str(BUILD / "music.wav"), "wb") as w:
    w.setnchannels(2)
    w.setsampwidth(2)
    w.setframerate(SR)
    w.writeframes((stereo * 32767).astype(np.int16).tobytes())
print("配乐已生成", round(T, 2), "s")
