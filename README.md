# 文启 FileAction

**收到文件，先交给文启。**

文启是一个以文件为入口的个人行动助手，帮你理解一份文件对当下的你意味着什么，再把这份意义变成具体行动。我们首先关注反复阅读、筛选并联系自身背景的成本；有依据的个性化解读是第一交付，用户可以到此结束，选择继续后再形成可编辑产物。

这是西客松 XiHack 2026「文启 / FileAction（可行动事务 Agent）」的代码仓库。方案、研究与交互设计稿放在 `docs/`，静态宣传页及配套说明单独放在 `frontend/`。当前主线是**个人端 MVP 的验证**：结合已确认背景、分清原文与推断、按需询问、让用户查看和决定是否保留沉淀。团队协作与企业级应用是未来探索。Document → 可行动事务 → Workflow 只在用户选择行动时继续展开。

## 当前状态与开发入口

**2026年10月3日：当前 main 工作区已引入开发分支的个人端代码，并完成个人理解主线和评委体验改造。** 正式前端位于 `front/`，API 与生成处理进程位于 `backend/`。`frontend/` 宣传页保留合成示例标识，并实际接入产品首页、`/intro/` 路由和生产构建。使用合成材料走通了真实模型解读、引用核对、背景保留与主动复用、产物起草、版本编辑及导出内容核对（此次下载落盘限制见下文）；这不代表所有场景或上线能力已完成验收。当前没有真人访谈或付费证据。

- 产品重点以用户于2026年10月2日指定的《路演(1).md》为基准，见 [核心路演稿](docs/03-参赛与路演/可行动事务Agent-核心路演稿.md)；[参赛主线方案](docs/01-产品方案/可行动事务Agent-参赛主线方案.md)落实范围与验收。[差异与修订记录](docs/03-参赛与路演/可行动事务Agent-路演口径差异与修订记录.md)说明本次调整。
- 原稿提及的预设体验和产品画面是待按实际进度核验的展示目标，不作为已实现证明；奖学金不是产品唯一场景，企业成员个人使用也不等于企业级能力。
- 开发规则见 [AGENTS.md](AGENTS.md)，仓库导航与常用命令见 [CLAUDE.md](CLAUDE.md)。
- 本届成果须在官方 67 小时开发窗口内完成；赛期依据及团队冻结约定见开发规则，正式通知优先。10月2日转来的赛事方案仅为方向参考，不是确定规则。
- 9月30日规则 Demo 和10月1日文启高保真 Demo 都是既有设计资产：后者是静态流程可视化、非定稿 UI，未接模型或真实长期记忆，不能当作赛中产品成果；制作时间与申报按事实记录。
- 讲解视频是合成概念动画，不是产品实录；旧片仍使用“旁批”。MP4 本地保留但不纳入 Git，新克隆不会包含成片，也不保证包含生成所需的本机中间资料。

## 本地运行本轮产品

本机已实测 Python 3.14、Node.js、Docker Desktop 环境。启动前先安装依赖：

```sh
python3 -m venv .venv
.venv/bin/python -m pip install -r backend/requirements.txt
npm --prefix front ci
```

启动专属数据库、缓存与 API（不接模型也可查看界面；上传和核对原文需要有效 COS 配置）：

```sh
.venv/bin/python scripts/local_preview.py start --no-worker
FILEACTION_DEV_API_TARGET=http://127.0.0.1:18800 npm --prefix front run dev -- --port 8785 --strictPort
```

打开 [文启首页](http://127.0.0.1:8785/)。首页统一使用完整宣传 Web，`/` 自动进入 `/intro/`；产品 Logo 和“返回首页”也返回同一页面，保留全部滚动章节与动效。首次使用可在产品中创建本地账号，首页里的“上传文件”进入真实文件空间。

真实解读需要在本机被忽略的 `var/local-preview/model.json` 中配置 `base_url`、`api_key`、`model`，服务须支持 OpenAI 兼容 JSON 输出。配置后停止并重新启动，API 与生成处理进程均需运行：

```sh
.venv/bin/python scripts/local_preview.py stop
.venv/bin/python scripts/local_preview.py start
.venv/bin/python scripts/local_preview.py status
```

启动器不读取根目录 `.env`；凭据与数据仅写入被忽略的 `var/`，停止不删除数据卷。COS 配置从 `var/local-preview/storage.env` 读取，使用 `STORAGE_DRIVER=cos`、`COS_REGION`、`COS_BUCKET`、`COS_SECRET_ID`、`COS_SECRET_KEY` 、`COS_PREFIX` 和可选的 `COS_OBJECT_MODE`，启动器仅将这些存储配置映射为后端使用的 `FILEACTION_COS_*`，文件权限为0600。每次模型调用仍需在界面确认具体内容和服务方。

本机已使用 `COS_OBJECT_MODE=immutable_key` 兼容未开启版本控制的桶，真实 PDF 上传、原件完整读取和禁止覆盖检查通过，未修改桶设置。默认模式仍为 `versioned`；Compose 对应变量为 `FILEACTION_COS_OBJECT_MODE`。上传界面统一保存到文件空间，不要求用户选择存储方式。

本机 `admin` 体验账号登录后，在文件空间点击“体验预设场景”，即可使用明确标注的合成 PDF 和背景；每次解读均需确认发送范围并真实调用模型，也可上传自己的文件。密码只保存在本机受控的 `var/local-preview/default-account.json`，不随源码分发。详见 [评委体验指引](docs/03-参赛与路演/可行动事务Agent-评委体验指引.md)。

文件原件已长期保存；解读、消息和成果目前属于本次登录会话，刷新和本次会话内重新打开可恢复结构化解读及引用。整工作区跨登录长期保留尚未打通，长期个人背景仍由用户单独选择保存。本轮已核对 v2 导出内容和复制入口；内置浏览器取消了下载，文件下载落盘仍需在评委实际浏览器复验，不作为本轮通过项。

本轮实测检查：

```sh
npm --prefix front test -- --run
npm --prefix front run typecheck
npm --prefix front run build
.venv/bin/python -m pytest -q backend/tests/test_local_preview.py
git diff --check
```

详细边界与真实验收记录见 [本轮改造与验收](docs/01-产品方案/可行动事务Agent-个人端主线改造与验收.md)。

## 文档入口

| 想了解 | 文档 |
|---|---|
| 产品宣传页 | [打开文启宣传页](frontend/index.html) · [使用说明](frontend/可行动事务Agent-宣传页说明.md)（保留静态合成示例；产品内 `/intro/` 入口真实接通上传） |
| 品牌与界面设计 | [Logo 设计说明](docs/01-产品方案/可行动事务Agent-Logo设计说明.md) · [UI 界面设计稿](docs/05-交互Demo/可行动事务Agent-文启UI界面.html) |
| 文档地图 | [文档总览](docs/可行动事务Agent-00-总览.md) |
| 核心项目重点与5分钟叙事 | [核心路演稿](docs/03-参赛与路演/可行动事务Agent-核心路演稿.md) |
| 原有偏差与修订依据 | [差异与修订记录](docs/03-参赛与路演/可行动事务Agent-路演口径差异与修订记录.md) |
| 定位、范围与分工 | [参赛主线方案](docs/01-产品方案/可行动事务Agent-参赛主线方案.md) |
| 同类产品与差异 | [竞品分析](docs/02-调研与可行性/可行动事务Agent-竞品分析.md) |
| 路演与问答口径 | [路演答辩应答卡](docs/03-参赛与路演/可行动事务Agent-路演答辩应答卡.md) |
| 用户验证方法 | [用户验证执行卡](docs/03-参赛与路演/可行动事务Agent-用户验证执行卡.md) |

用 Obsidian 打开仓库根目录阅读；现行文档的 wiki links 以根目录为基准，使用实际所在的 `docs/` 或 `frontend/` 路径。历史归档保持原样，其中旧路径仅作为历史记录。

## 运行赛前交互设计稿（不是 MVP）

在仓库根目录运行。静态服务需要 Python 3，规则测试需要 Node.js，无第三方依赖：

```sh
python3 docs/05-交互Demo/serve.py                    # 只监听本机 http://127.0.0.1:8765/
node --test docs/05-交互Demo/tests/engine.test.mjs   # 赛前规则测试，不是产品测试
```

这些页面仅使用合成数据与规则模拟，不向外部模型发送资料。使用方法见 [交互 Demo 使用说明](docs/05-交互Demo/可行动事务Agent-交互Demo使用说明.md)。讲解视频的生成工具另有依赖，见 [讲解视频说明](docs/06-讲解视频/可行动事务Agent-讲解视频说明.md)。

## 目录

```text
FileAction/
├── README.md                    仓库首页与开发入口
├── AGENTS.md                    代码优先开发规则与文档规范
├── CLAUDE.md                    仓库导航与协作提示
├── front/                       正式 React 前端与交互测试
├── backend/                     API、生成处理进程、数据库迁移及测试
├── scripts/                     隔离的本地预览启动器
├── src/、tests/                 早期预留目录，产品入口以实际 front/backend 为准
├── frontend/                    静态概念宣传页、样式、脚本与配套说明
├── docs/
│   ├── 可行动事务Agent-00-总览.md
│   ├── 01-产品方案/
│   ├── 02-调研与可行性/
│   ├── 03-参赛与路演/
│   ├── 05-交互Demo/             赛前设计稿，不复制到 src/
│   ├── 06-讲解视频/              概念动画源码，MP4 仅本地保留
│   └── 90-历史归档/              原始草稿与旧方案，正文不改写
├── .planning/                   来源、核查记录与整理前副本
└── .obsidian/                   编辑器配置
```

## 说明

- 产品名“文启 / FileAction”于2026年10月1日确定，尚未做商标查重。
- 外部事实以来源和实际读取日期为准；正式评审规则以官方最新书面通知为准。当前计划为5分钟 PPT 展示及评委测试账号线下试用，细节待书面确认。
- 团队版、企业版与商业路径均需独立验证；本机保存不代表云端模型看不到数据。
