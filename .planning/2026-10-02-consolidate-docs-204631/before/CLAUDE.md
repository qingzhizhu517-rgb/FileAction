# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 仓库性质

这里是西客松 XiHack 2026 参赛项目「文启 / FileAction（可行动事务 Agent）」的代码仓库，产品继续在本仓库开发。根目录 `src/`、`tests/` 预留给 MVP，目前尚未实现，没有可用的根目录 MVP 开发或测试命令。方案和赛前资产移入 `docs/`；当前可运行的交互设计稿与讲解动画均不属于赛中产品。开发与文档维护规则以 `AGENTS.md` 为准。文档地图见 `docs/可行动事务Agent-00-总览.md`。

## 现行产品主线

用户于2026年10月2日指定《路演(1).md》为核心重点。先读 `docs/03-参赛与路演/可行动事务Agent-核心路演稿.md`，再读参赛主线方案与差异修订记录。收到文件，先交给文启：结合已确认背景，解释与用户有关的内容、理由、要求和限制；用户选择后再生成可编辑产物。团队与企业是未来探索。

不要把材料复用、禁重复申报、固定三态、关联图或团队分工重新写成通用主流程；不规定每次先问一个问题，不默认保存每次回答。允许跳过补充、不保留沉淀和只理解后结束。计划口径与实际实现证据分开，旧设计资产不能证明当前 MVP 已可用。

## 常用命令

```sh
rg --files -g '*.md'                    # 列出文档
rg -n '\[\[' -g '*.md' .                # 检查 Obsidian 双向链接
python3 docs/05-交互Demo/serve.py            # 启动设计稿，只监听 127.0.0.1:8765；可加 --port 8766 --no-browser
node --test docs/05-交互Demo/tests/engine.test.mjs                          # 全部规则测试
node --test --test-name-pattern '导出' docs/05-交互Demo/tests/engine.test.mjs  # 按名称跑单个测试
```

上述交互设计稿无需第三方依赖或构建，需要 Python 3 和 Node.js；这些不是 MVP 命令。讲解动画的渲染另需 Playwright/Chromium、ffmpeg、edge-tts、NumPy 等，具体见对应说明。

## 代码结构

### `docs/05-交互Demo/`：9月30日旧方案设计稿（规则模拟，未接模型）

- 纯 ES module，不需要打包。`serve.py` 以仓库根目录作为静态根目录，把 `/` 重定向到 `/docs/05-交互Demo/index.html`，所以页面要通过它打开，不要直接用 file://。
- `engine.mjs` 是纯逻辑层，没有 DOM，也没有网络请求。`parseFile` 只解析受控 TXT 格式（`行动事务演示TXT-v1`），识别为 notice 或 material，并给出带行号的 evidence。`evaluate` 把通知要求 R1–R6 和材料对照，输出六种状态（未检查 / 可引用候选 / 需更新 / 本次未找到 / 不可用于本次 / 无法判断）。`correctMaterial` 和 `exportMarkdown` 负责更正与导出。测试只覆盖这一层。
- `fixtures.mjs` 存放合成通知、记忆材料和固定日期 `DEMO_DATE`，测试与页面共用。`samples/*.txt` 是给用户下载、上传用的同格式样本。
- `app.mjs` 管理状态和事件，`view.mjs`（`createViews`）负责渲染。`demo-with-memory.html` 和 `demo-no-memory.html` 通过 `body[data-mode]` 进入两种模式，各自使用独立的 localStorage 键 `doagent.demo.<mode>.memory.v1`。
- `可行动事务Agent-文启高保真Demo.html` 是10月1日新增的单文件静态流程可视化，内联了全部 CSS/JS，浏览器直接打开即可。它与上面的引擎无关，不是定稿 UI。

### `docs/06-讲解视频/`：概念动画（合成示意，非产品实录）

`docs/06-讲解视频/src/` 里的页面动画完全由时间驱动，`src/index.html?t=秒数` 可以定格某一时刻。渲染流程依次为 `tts.sh` → `build_timeline.py` → `capture.mjs`（无头 Chromium 逐帧截图）→ `music.py` / `subtitles.py` → `assemble.sh`（ffmpeg）。完整命令和依赖见 `docs/06-讲解视频/可行动事务Agent-讲解视频说明.md`。`build/` 是中间产物，已被 gitignore，`build/narration.tsv` 也在其中。片中仍使用旧名「旁批」。

## 文档约定（摘自 AGENTS.md）

- 正文和回复都用中文。新业务文件命名为 `可行动事务Agent-主题.md`，放进 `docs/` 对应编号目录，并同步更新总览。每篇只有一个一级标题。
- 链接写成 `[[docs/目录/文档名|可读名称]]`，表格里的 `|` 要转义为 `\|`。移动或重命名文件时，同步修改现行文档中的引用。
- 保留 YAML front matter，正文有改动就更新 `updated`。`updated` 只表示编辑时间，不代表外部来源已重新核验。
- 修改文档前，把原文和路径清单备份到 `.planning/日期-任务/`。`.planning/` 下已有的快照和 `docs/90-历史归档/` 的正文都不要改写，原始草稿要原样保留。
- 改完要核对标题、表格、代码围栏和链接。赛中代码有改动时，要跑测试并在浏览器里实际走通。

## 真实性底线

- 外部事实要附来源和实际读取日期。不编造用户、访谈、测试结果或数据。演示资料必须是合成数据，并标明这一点。
- 赛前资产（设计稿、讲解视频）要如实申报，不能当作本届成果；本届成果必须在官方67小时窗口内完成。
- 不要写「零幻觉」「竞品都做不到」这类说法。本机保存不等于云端模型看不到数据。团队版、企业版和商业路径都是待验证的假设。
- 不要提交 `.DS_Store`、`.obsidian/workspace*.json` 和密钥。

## 协作边界

- `chore/docs-and-mvp` 是已合入 `main` 的历史结构迁移分支，日常任务使用普通任务分支并遵守用户对当前工作树的要求。没有对应任务的明确授权，不 commit/push/merge；保留已有未提交内容和 stash。
- 两个讲解 MP4 及宣传片 MP4 本地保留、Git 忽略；历史归档正文与既有 `.planning/` 快照不改写。
- 不伪造开发、提交或核验时间；节点属于团队约定，赛事方向材料不作为确定规则，正式书面通知优先。
