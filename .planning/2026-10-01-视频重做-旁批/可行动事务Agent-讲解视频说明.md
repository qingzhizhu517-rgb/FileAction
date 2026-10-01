---
tags:
  - 项目/可行动事务Agent
  - 讲解视频
created: 2026-10-01
updated: 2026-10-01
status: 概念讲解动画；画面为设计示意，非产品实录
---

# 可行动事务 Agent · 讲解视频说明

导航：[[可行动事务Agent-00-总览|文档总览]] · [[01-产品方案/可行动事务Agent-参赛主线方案|参赛主线方案]]

## 1. 成片

- 视频：`output/DoAgent-讲解视频.mp4`，1920×1080，30fps，约112秒，H.264 + AAC。
- 字幕：画面内已烧录；另附 `output/DoAgent-讲解视频.srt` 供上传平台单独加载。
- 配音为 macOS 系统中文语音 Tingting；配乐与音效由程序合成，未使用外部素材。

## 2. 内容与使用边界

12个场景依次讲：通知刷屏、通用 AI 人人一样、品牌亮相、零记忆首问、记忆生长、主动发现、可信复用（拦下往届获奖证明）、直接行动、不硬凑待办、团队临时组队、三层内核、结尾口号。

**这是概念动画，不是产品录屏。** 画面中的界面、人物、证书与通知均为合成示意，对应[[01-产品方案/可行动事务Agent-参赛主线方案|参赛主线方案]]的设计，尚无真实模型运行。赛前制作的讲解材料按赛事规则申报，不能当作本届实现成果；若用于正式展示，应说明“概念演示”，并以赛中真实录屏展示实际功能。产品中文名待定，片中使用工作名 DoAgent。

## 3. 修改与重新生成

源文件在 `src/`：`style.css` 为视觉样式，`scenes-a.js`、`scenes-b.js` 为12个场景，`main.js` 负责转场、字幕与背景。所有动画只由时间决定，可逐帧复现。

```sh
cd 06-讲解视频
# 1. 改旁白：编辑 build/narration.tsv 后重新生成配音与时间轴
while IFS=$'\t' read -r id text; do say -v Tingting -r 185 -o "build/audio/$id.aiff" "$text"; done < build/narration.tsv
python3 src/build_timeline.py
# 2. 预览某几个时刻（输出到 build/preview/）
node src/capture.mjs --preview 20,59,92
# 3. 全量渲染、配乐、字幕与合成
node src/capture.mjs --workers 6
python3 src/music.py && python3 src/subtitles.py && sh src/assemble.sh
```

也可以用浏览器打开 `src/index.html` 实时播放动画，或加 `?t=秒数` 定格某一时刻。渲染依赖本机已安装的 Chromium 无头浏览器（Playwright 缓存）、ffmpeg、Python 3 与 NumPy；`build/` 下的帧序列为中间产物，可删除。
