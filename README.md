# AI软件赛道-FileAction文启-轻舟过海

**收到文件，先交给文启。**

文启是一个以文件为入口的个人行动助手，帮你理解一份文件对当下的你意味着什么，再把这份意义变成具体行动。我们首先关注反复阅读、筛选并联系自身背景的成本；有依据的个性化解读是第一交付，用户可以到此结束，选择继续后再形成可编辑产物。

这是西客松 XiHack 2026「文启 / FileAction（可行动事务 Agent）」的代码仓库。方案、研究与交互设计稿放在 `docs/`，静态宣传页及配套说明单独放在 `frontend/`。当前主线是**个人端 MVP 的验证**：结合已确认背景、分清原文与推断、按需询问、文件沉淀自动加入用户档案，并让用户查看来源、修改或删除。团队协作与企业级应用是未来探索。Document → 可行动事务 → Workflow 只在用户选择行动时继续展开。

> **参赛交付物（仓库根目录）**：[项目说明文档（Word）](文启FileAction-项目说明文档.docx) · [产品使用及介绍.mp4](产品使用及介绍.mp4)

## 技术栈

| 层 | 技术 |
|---|---|
| 正式前端 `front/` | React 19 + TypeScript + Vite；react-router；@tanstack/react-query；lucide-react |
| 正式后端 `backend/` | Python + FastAPI + uvicorn；SQLAlchemy(async) + Alembic + PostgreSQL（pgvector）；Redis；LangGraph（Agent 编排） |
| 本机 MVP `src/` | Python 标准库 HTTP 服务，仅依赖 pypdf 与 cos-python-sdk-v5 |
| 文件解析 | pypdf（带文字层 PDF）、python-docx（DOCX）、标准库处理 TXT / MD |
| 存储 | 腾讯云 COS（cos-python-sdk-v5）；本机数据落在 Git 忽略的 `var/` |
| 部署 | Docker Compose：postgres / redis / api / worker / indexing / front / migrate |
| 测试 | pytest 与 unittest（后端）、Vitest + Testing Library（前端）、Playwright（浏览器验收） |

## 大模型与赞助商 API

| 用途 | 服务方 / 模型 | 调用方式 | 配置位置 |
|---|---|---|---|
| 文件解读与产物生成 | OpenAI 兼容大模型，默认 `gpt-5.6-sol` | OpenAI 兼容接口，支持 JSON 输出模式与流式返回 | 环境变量 `FILEACTION_BASE_URL` / `FILEACTION_MODEL` / `FILEACTION_API_KEY`（可选 `FILEACTION_JSON_MODE=1`），或 Git 忽略的 `var/model-config.json`（0600），页面「模型设置」可临时覆盖 |
| 原文件与工作区快照持久化 | 腾讯云 COS | cos-python-sdk-v5 官方 SDK | 环境变量或页面「COS 设置」：`COS_REGION` / `COS_BUCKET` / `COS_SECRET_ID` / `COS_SECRET_KEY` / `COS_PREFIX`，可选 `COS_OBJECT_MODE` |

每次模型调用前均需在界面确认发送范围；密钥只从环境变量或 Git 忽略的受控配置读取，浏览器不接收密钥。未配置或调用失败时明确报错，不生成假结果。

## 当前状态与开发入口

**2026年10月3日：当前 main 工作区已引入开发分支的个人端代码，并完成个人理解主线和评委体验改造。** 正式前端位于 `front/`，API 与生成处理进程位于 `backend/`。`frontend/` 宣传页保留合成示例标识，并实际接入产品首页、`/intro/` 路由和生产构建。使用合成材料走通了真实模型解读、引用核对、背景保留与主动复用、产物起草、版本编辑及导出内容核对（此次下载落盘限制见下文）；这不代表所有场景或上线能力已完成验收。当前没有真人访谈或付费证据。

**2026年10月3日已实现本机单用户 MVP 流程。** 新产品代码在 `src/`，测试在 `tests/`，没有复制赛前规则 Demo。依据本次提供的《路演(3).md》和《路演_品牌黄版(1).pptx》实现：拖入新文件、历史文件工作区、多会话对话、全局用户档案与可编辑文件沉淀、档案来源白盒展示、真实流式文字、分块日期和链接摘要、原文引用、可跳过的问题、用户选择行动、编辑与 Markdown 导出。文件持久化使用腾讯云 COS，记忆参考 Hermes 的精选条目与会话快照机制。

界面与合成替身流程已经测试；**后台已配置 `gpt-5.6-sol`，真实模型已通过合成通知的解读、引用、初稿与编辑导出验收；真实 COS 云端读写仍待配置验收**。没有配置或调用失败时明确报错，不生成假结果。详细范围与记录见 [MVP 运行与验收](docs/01-产品方案/可行动事务Agent-MVP运行与验收.md)。

### 启动个人端 MVP

用户选择保留8787中的两个临时文件，因此当前新版运行于 **http://127.0.0.1:8788/**，旧8787服务继续保留。新版使用独立的 `var/current/` 受控运行目录，带入启动时已有用户档案和后台模型配置；两个服务后续数据独立，原临时文件继续在8787查看。

本机已安装虚拟环境和依赖，当前新版启动命令：

```sh
./run.sh --port 8788 --data-dir var/current
# 打开 http://127.0.0.1:8788/
```

不指定参数时 `./run.sh` 仍默认8787与 `var/`；当前新版的模型、档案和对象索引位于 `var/current/`，该目录整体 Git 忽略。

模型可由后台 `var/model-config.json` 自动加载，支持本次提供的 OpenAI 兼容配置结构；默认 `gpt-5.6-sol`，保留配置中的6个模型 ID。该受控文件权限为0600，处于 Git 忽略目录，浏览器不接收密钥。环境变量优先于后台文件；页面「模型设置」可临时覆盖本次服务配置。

COS 仍在「COS 设置」填写 Bucket、Region、SecretId、SecretKey，页面提交的 COS 密钥只在服务内存中，重启需重新填写，也可通过环境变量配置。

最小体验：确认模型发送范围后上传文件，直接进入 Agent；先得到总结，有沉淀时一并结合。可以回应一两条核心问题、纠正用户定位猜测、自由追问，或看完直接结束。Agent 根据文件和对话给出可选产物入口，点击后才展开确认与生成。每份文件可以新开多个会话，也可从首页最近文件重新打开。文件沉淀自动加入用户档案，无需逐条确认；新会话右侧展示相关档案依据，可直接修改，文件卡片同步更新、下一轮重载。回复与初稿边生成边显示，完成后核对引用并保存。关闭保留历史；勾选首页 COS 保存或在侧栏启用后，原文件、对话、沉淀与草稿自动保存为 COS 工作区快照。未启用时明确标为临时工作区，服务停止后无法恢复。

原文入口会弹出可滚动文本并高亮引用；阅读视角与核心问题可点击填写回答，也可跳过。解读先显示与档案和当前目标有关的判断，通用文件概要折叠；每条请求附带可查看的阅读方式，要求模型直接回答、不反复索取已知身份。当前页面可直接刷新升级，已有临时工作区和对话保留，无需重启。

新克隆安装依赖（建议 Python 3.12+，使用 OpenSSL）：

```sh
python3 -m venv .venv
.venv/bin/python -m pip install -r requirements.txt
./run.sh
```

后端测试命令已实测，合成数据与模型 / COS 替身均明确标注：

```sh
.venv/bin/python -m unittest discover -s tests -v
```

该测试会临时监听本机端口。通过不代表真实模型和真实云存储已经验收。

- 产品重点以用户于2026年10月2日指定的《路演(1).md》为基准，见 [核心路演稿](docs/03-参赛与路演/可行动事务Agent-核心路演稿.md)；[参赛主线方案](docs/01-产品方案/可行动事务Agent-参赛主线方案.md)落实范围与验收。[差异与修订记录](docs/03-参赛与路演/可行动事务Agent-路演口径差异与修订记录.md)说明本次调整。
- 原稿提及的预设体验和产品画面是待按实际进度核验的展示目标，不作为已实现证明；奖学金不是产品唯一场景，企业成员个人使用也不等于企业级能力。
- 开发规则见 [AGENTS.md](AGENTS.md)，仓库导航与常用命令见 [CLAUDE.md](CLAUDE.md)。
- 本届成果须在官方 67 小时开发窗口内完成；赛期依据及团队冻结约定见开发规则，正式通知优先。10月2日转来的赛事方案仅为方向参考，不是确定规则。
- 9月30日规则 Demo 和10月1日文启高保真 Demo 都是既有设计资产：后者是静态流程可视化、非定稿 UI，未接模型或真实长期记忆，不能当作赛中产品成果；制作时间与申报按事实记录。
- 讲解视频是合成概念动画，不是产品实录；旧片仍使用“旁批”。概念动画成片默认本地保留；用户指定的宣传页视频 `frontend/project-video.mp4` 与参赛演示视频 `产品使用及介绍.mp4` 例外纳入 Git，新克隆可直接获取。其他成片及本机中间资料不保证包含。

## main 首页与本机文件 Agent 的账号入口

2026年10月3日已在 `main` 接入账号入口。新入口复用 `frontend/` 完整首页和 `front/` 的登录注册组件，登录后进入本次 `src/` 文件 Agent，保留三栏、多会话、流式输出、自动个人沉淀、原文核对和导出。

```sh
npm --prefix front ci
npm --prefix front run build
./run.sh --with-auth --port 8789 --data-dir var/accounts
```

打开 [新账号入口](http://127.0.0.1:8789/)，从首页点击上传，创建个人账号即可进入。密码为12–128字符；没有默认密码或预置管理员。后台已从现有受控配置带入模型；页面可按账号覆盖模型和配置 COS。账号库与用户档案写入 Git 忽略的 `var/accounts/`；密码经过 scrypt 加盐哈希，登录会话使用 HttpOnly/SameSite Cookie，退出撤销会话。每个账号拥有独立文件索引、工作区、档案、模型覆盖与 COS 配置，浏览器打开文件状态也按账号区分。

首页保留 main 的全部章节与动效。2026年10月4日按用户指定，将 `../宣传片/文启-宣传片-v2.mp4` 接入“看看如何理解”按钮；100秒网页副本为 `frontend/project-video.mp4`，点击后在页内播放。用户于同日明确要求将该网页视频纳入 Git，克隆仓库后即可构建并部署，无需另外补回媒体文件。

此入口使用 `src/` 的本机账号实现，接口兼容 main 登录组件所需的 `/api/v1/auth/*`，与下文 `backend/` 的 PostgreSQL 账号库独立。不会读取或迁入原单用户的文件、档案或其他账号的数据。8787、8788 原服务保留，不需重启；旧文件仍从原地址继续查看。登录不会将临时文件变为长期文件：未启用 COS 的工作区仍只保留到该服务停止，启用 COS 后才保存原文件、对话与沉淀。

新增验收使用合成账号和文件，模型与 COS 使用隔离替身；不作为本轮真实模型或真实 COS 验收。测试入口为 `tests/test_auth_integration.py`、`tests/auth_browser.cjs`、`tests/auth_e2e_server.py`。账号测试和原产品后端测试已通过，登录组件/API/首页测试和生产构建已通过。

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
| 完整项目说明（参赛必交） | [项目说明文档（Word）](文启FileAction-项目说明文档.docx)（系统架构、模块、数据、接口、测试与部署） |
| 产品演示视频（参赛必交） | [产品使用及介绍.mp4](产品使用及介绍.mp4) |
| 产品宣传页 | [打开文启宣传页](frontend/index.html) · [使用说明](frontend/可行动事务Agent-宣传页说明.md)（保留静态合成示例；产品内 `/intro/` 入口真实接通上传） |
| 品牌与界面设计 | [Logo 设计说明](docs/01-产品方案/可行动事务Agent-Logo设计说明.md) · [UI 界面设计稿](docs/05-交互Demo/可行动事务Agent-文启UI界面.html) |
| 文档地图 | [文档总览](docs/可行动事务Agent-00-总览.md) |
| 新产品运行与验收范围 | [MVP 运行与验收](docs/01-产品方案/可行动事务Agent-MVP运行与验收.md) |
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
├── README.md                          仓库首页与开发入口
├── AGENTS.md                          代码优先开发规则与文档规范
├── CLAUDE.md                          仓库导航与协作提示
├── 文启FileAction-项目说明文档.docx     项目说明文档（参赛必交）
├── 产品使用及介绍.mp4                   产品演示视频（参赛必交）
├── compose.yaml                       正式全栈编排：数据库 / 缓存 / API / 前端
├── .env.example                       环境变量样例

├── front/                             正式 React 前端与交互测试
├── backend/                           FastAPI：API、生成处理进程、迁移及测试
├── scripts/                           隔离的本地预览启动器
├── src/                               本机 MVP：文件解析、模型、COS、记忆与网页
├── tests/                             产品逻辑、HTTP、COS 与浏览器验收
├── run.sh                             个人端启动入口
├── requirements.txt                   本机 MVP 依赖（pypdf、COS SDK）
├── frontend/                          静态概念宣传页、样式、脚本与配套说明
├── docs/
│   ├── 可行动事务Agent-00-总览.md       文档入口
│   ├── 01-产品方案/
│   ├── 02-调研与可行性/
│   ├── 03-参赛与路演/
│   ├── 05-交互Demo/                    赛前设计稿，不复制到 src/
│   ├── 06-讲解视频/                     概念动画源码，MP4 仅本地保留
│   └── 90-历史归档/                     原始草稿与旧方案，正文不改写
├── .planning/                         来源、核查记录与整理前副本
└── .obsidian/                         编辑器配置
```

## 说明

- 产品名“文启 / FileAction”于2026年10月1日确定，尚未做商标查重。
- 外部事实以来源和实际读取日期为准；正式评审规则以官方最新书面通知为准。当前计划为5分钟 PPT 展示及评委测试账号线下试用，细节待书面确认。
- 团队版、企业版与商业路径均需独立验证；本机保存不代表云端模型看不到数据。
