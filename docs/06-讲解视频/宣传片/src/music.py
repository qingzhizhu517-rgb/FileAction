"""程序合成配乐：96 BPM 极简电子，重击对齐画面关键帧。不使用外部素材，不联网。

结构（秒）：0–15 垫音+拨弦 → 15 品牌重击，鼓与贝斯进入 → 42.5 印章重击 →
55–62.5 抽空（按需索取段）+ 上扬 → 62.5 重击回归 → 76.25 收尾长和弦。
"""
import wave
from pathlib import Path

import numpy as np

OUT = Path(__file__).resolve().parent.parent / "build" / "music.wav"
SR, TOTAL, BPM = 48000, 84.0, 96
BEAT = 60 / BPM
n = int(SR * TOTAL)
L = np.zeros(n)
R = np.zeros(n)
rng = np.random.default_rng(11)


def midi(m):
    return 440.0 * 2 ** ((m - 69) / 12)


def add(sig, at, gain=1.0, pan=0.0):
    i = int(at * SR)
    if i >= n:
        return
    sig = sig[: n - i] * gain
    L[i : i + len(sig)] += sig * (1 - max(0, pan))
    R[i : i + len(sig)] += sig * (1 + min(0, pan))


def env_t(dur):
    return np.arange(int(dur * SR)) / SR


def pluck(f, dur=0.9):
    t = env_t(dur)
    y = sum(a * np.sin(2 * np.pi * f * k * t) * np.exp(-t * (5 + 3 * k)) for k, a in enumerate([1, .5, .25, .12], 1))
    return y * np.minimum(1, t / 0.004)


def pad(notes, dur):
    t = env_t(dur)
    y = sum(np.sin(2 * np.pi * midi(m) * d * t) for m in notes for d in (0.997, 1.003))
    e = np.minimum(1, t / 1.2) * np.minimum(1, (dur - t) / 1.2)
    return y * e / (2 * len(notes))


def kick():
    t = env_t(0.45)
    f = 45 + 110 * np.exp(-t * 30)
    return np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t * 7)


def hat(dur=0.06):
    t = env_t(dur)
    x = rng.standard_normal(len(t))
    x = np.diff(x, prepend=0)  # 粗略高通
    return x * np.exp(-t * 70) * 0.5


def clap():
    t = env_t(0.25)
    x = rng.standard_normal(len(t))
    return x * (np.exp(-t * 25) + 0.5 * np.exp(-((t - 0.012) % 0.011) * 300)) * 0.35


def bass(f, dur):
    t = env_t(dur)
    return (np.sin(2 * np.pi * f * t) + 0.25 * np.sin(4 * np.pi * f * t)) * np.exp(-t * 3) * np.minimum(1, t / 0.01)


def impact():
    t = env_t(2.5)
    f = 38 + 80 * np.exp(-t * 12)
    boom = np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t * 2.2)
    noise = rng.standard_normal(len(t)) * np.exp(-t * 9) * 0.25
    return boom + noise


def riser(dur):
    t = env_t(dur)
    x = rng.standard_normal(len(t))
    k = int(SR * 0.002)
    sm = np.convolve(x, np.ones(k) / k, mode="same")
    mix = (t / dur) ** 2
    return (sm * (1 - mix) + x * mix) * (t / dur) ** 2.5 * 0.35


# 和弦：Dm9 → B♭maj7 → F → C，每和弦 4 拍
PROG = [[50, 57, 60, 64, 65], [46, 53, 57, 62, 65], [41, 53, 57, 60, 64], [48, 55, 59, 62, 64]]
ROOT = [38, 34, 41, 36]
ARP = [0, 2, 3, 4, 3, 2, 1, 3]
bar = BEAT * 4
for b in range(int(TOTAL / bar) + 1):
    t0 = b * bar
    ch = PROG[b % 4]
    breakdown = 55 <= t0 < 62.5
    ending = t0 >= 76.25
    if not ending:
        add(pad(ch, bar + 1.2), t0, 0.16 if not breakdown else 0.22)
    for s in range(8):  # 八分音符拨弦
        at = t0 + s * BEAT / 2
        if at >= 76.25:
            break
        add(pluck(midi(ch[ARP[s]] + 12)), at, 0.12 if at < 15 else 0.1, pan=0.3 if s % 2 else -0.3)
    if 15 <= t0 < 76.25 and not breakdown:
        for s in range(4):
            at = t0 + s * BEAT
            add(kick(), at, 0.55)
            add(bass(midi(ROOT[b % 4]), BEAT * 0.9), at + BEAT / 2, 0.35)
            if t0 >= 20:
                add(hat(), at + BEAT / 2, 0.25, pan=0.2)
                add(hat(0.03), at + BEAT * 0.75, 0.12, pan=-0.2)
            if s in (1, 3) and t0 >= 30:
                add(clap(), at, 0.4)

# 通知落下的轻敲（与 scenes-a.js 的 S1_LAND 同步）
for i in range(18):
    at = 0.6 + i * BEAT * 0.5
    add(pluck(midi(76 + (i * 5) % 12), 0.25), at, 0.11, pan=(i % 5 - 2) / 4)
    add(hat(0.02), at, 0.18, pan=(i % 5 - 2) / 4)
add(clap(), 12.5, 0.5)                    # 「人人一样」印章
for at in (15, 62.5):
    add(impact(), at, 0.7)
add(riser(2.4), 15 - 2.4, 1.0)
add(riser(3.0), 62.5 - 3.0, 1.0)
add(impact(), 42.5, 0.45); add(clap(), 42.5, 0.6)   # 「本次不能用」印章
add(impact(), 76.25, 0.6)
add(pad([41, 53, 57, 60, 64, 69], 7.5), 76.25, 0.3)  # 收尾 Fmaj9 长音
add(pluck(midi(77), 3.0), 76.25, 0.2)

# 淡出与限幅
fade = np.ones(n)
k = int(1.4 * SR)
fade[-k:] = np.linspace(1, 0, k)
mix = np.stack([L, R], 1) * fade[:, None]
mix = np.tanh(mix * 1.4) / np.tanh(1.4)
mix *= 0.89 / np.abs(mix).max()
OUT.parent.mkdir(parents=True, exist_ok=True)
with wave.open(str(OUT), "wb") as w:
    w.setnchannels(2)
    w.setsampwidth(2)
    w.setframerate(SR)
    w.writeframes((mix * 32767).astype("<i2").tobytes())
print("配乐已输出到", OUT)
