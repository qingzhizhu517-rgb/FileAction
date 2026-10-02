"""从时间轴导出 SRT 字幕，便于上传平台单独加载。"""
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
tl = json.loads((ROOT / "build/timeline.json").read_text(encoding="utf-8"))


def ts(x):
    ms = int(round(x * 1000))
    return f"{ms // 3600000:02d}:{ms // 60000 % 60:02d}:{ms // 1000 % 60:02d},{ms % 1000:03d}"


lines, n = [], 0
narr = dict(l.split("\t") for l in (ROOT / "build/narration.tsv").read_text(encoding="utf-8").splitlines())
for s in tl["scenes"]:
    subs = s["subs"] or [{"text": narr[s["id"]].rstrip("。"), "start": s["narrStart"], "end": s["narrStart"] + s["narrDur"]}]
    for x in subs:
        n += 1
        lines += [str(n), f"{ts(x['start'])} --> {ts(x['end'])}", x["text"], ""]
(ROOT / "output").mkdir(exist_ok=True)
(ROOT / "output/旁批-讲解视频.srt").write_text("\n".join(lines), encoding="utf-8")
print(f"字幕 {n} 条")
