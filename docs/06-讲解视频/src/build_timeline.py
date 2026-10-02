"""根据配音时长生成场景时间轴，供网页动画与混音共用。"""
import json
import re
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
BUILD = ROOT / "build"
NARR_OFFSET = 0.5  # 每个场景开始后多久开始配音
TAIL = {  # 配音结束后的留白（秒）
    "s1": 1.2, "s2": 1.4, "s3": 1.8, "s4": 1.6, "s5": 1.6, "s6": 1.6,
    "s7": 1.6, "s8": 1.4, "s9": 1.6, "s10": 1.4, "s11": 1.6, "s12": 3.0,
}
MIN_DUR = {"s4": 10.0, "s5": 7.6, "s10": 9.4, "s11": 6.8}  # 动画至少需要的时长
CPS = 4.6  # 没有配音文件时，按每秒字数估算
NO_SUB = {"s3", "s12"}  # 画面已出现同样文字的场景不再显示字幕


def duration(path: Path) -> float:
    out = subprocess.run(
        ["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", str(path)],
        capture_output=True, text=True, check=True,
    )
    return float(out.stdout.strip())


def split_segments(text: str, start: float, dur: float):
    """按句号切分字幕，时间按字数比例分配。"""
    parts = [p for p in re.split(r"(?<=[。：])", text) if p.strip()]
    total = sum(len(p) for p in parts)
    segs, t = [], start
    for p in parts:
        d = dur * len(p) / total
        segs.append({"text": p.strip().rstrip("。："), "start": round(t, 3), "end": round(t + d, 3)})
        t += d
    return segs


def main():
    scenes, t = [], 0.0
    for line in (BUILD / "narration.tsv").read_text(encoding="utf-8").splitlines():
        sid, text = line.split("\t")
        audio = BUILD / "audio" / f"{sid}.mp3"
        nd = duration(audio) if audio.exists() else round(len(re.sub(r"[，。：、！？]", "", text)) / CPS, 3)
        dur = round(max(NARR_OFFSET + nd + TAIL[sid], MIN_DUR.get(sid, 0)), 3)
        scenes.append({
            "id": sid, "start": round(t, 3), "dur": dur,
            "narrStart": round(t + NARR_OFFSET, 3), "narrDur": round(nd, 3),
            "subs": [] if sid in NO_SUB else split_segments(text, t + NARR_OFFSET, nd),
        })
        t += dur
    tl = {"fps": 30, "total": round(t, 3), "scenes": scenes}
    (BUILD / "timeline.json").write_text(json.dumps(tl, ensure_ascii=False, indent=2), encoding="utf-8")
    (ROOT / "src" / "timeline.js").write_text(
        "window.TIMELINE = " + json.dumps(tl, ensure_ascii=False) + ";\n", encoding="utf-8")
    print(f"总时长 {t:.2f}s，{len(scenes)} 个场景")


if __name__ == "__main__":
    main()
