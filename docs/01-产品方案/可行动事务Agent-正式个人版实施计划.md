---
tags:
  - 项目/可行动事务Agent
  - 实施计划
created: 2026-10-02
updated: 2026-10-03
status: 实施中；目录调整与正式版分阶段开发，未宣称完整验收
---

# 可行动事务 Agent · 正式个人版实施计划

> 执行者：使用 superpowers:subagent-driven-development 按任务实施与复核；每项完成须有可读证据。本仓库禁止未经授权commit/push/merge，覆盖技能中默认提交步骤。既有未提交文件必须保留，修改前备份；本计划不授权公网部署。

**目标：** 按用户指定将前端放入 `front/`、后端放入 `backend/`，在已验证MVP基础上实现前后端分离、多账号、COS原件、RAG及可编辑成果的正式个人版。

**架构：** React独立前端访问 `/api/v1`；FastAPI API与Worker分离。PostgreSQL/pgvector为正式业务与索引存储，Redis保存临时内容，COS保存明确保留的原件；缺失真实依赖时明确不可用，不回退SQLite或假结果。

**技术栈：** 保留现有React/TypeScript/Vite、FastAPI/Pydantic/httpx技术线；按设计新增SQLAlchemy/psycopg/Alembic、Redis、Argon2、COS SDK、pgvector、LangGraph、React Router和TanStack Query。

**规格：** [[docs/01-产品方案/可行动事务Agent-正式个人版技术开发设计|技术合同]]；[[docs/01-产品方案/可行动事务Agent-正式个人版架构与交互设计|产品与交互]]；高保真参考 `docs/05-交互Demo/可行动事务Agent-文启高保真Demo.html`。

## 全局约束与实施记录

- 用户本次指定的新目录优先于旧稿中的src路径：前端 `front/src/`，后端Python包 `backend/fileaction/`，后端测试 `backend/tests/`，浏览器测试 `front/e2e/`。
- 在当前 `codex/personal-mvp-design` 工作树保留未提交MVP继续开发；不创建缺失未跟踪源码的新工作树，不写Git索引。
- 旧MVP模块首先机械迁移；正式API使用独立应用工厂，不能在正式入口暴露旧无鉴权路由。旧MVP仅显式兼容入口用于历史回归。
- 根目录 `.env`、`.venv`、用户运行数据保持原位；配置只读、白名单加载、不输出值，测试禁用真实.env。
- 本次原始43个文件备份与路径hash：`.planning/2026-10-02-formal-development-1e4002ce/`，不包含密钥或用户数据。
- 起始回归：后端50 passed（1条既有Starlette/httpx弃用告警），前端12 passed。目录迁移不得把这些证据冒充正式版验收。
- 启动计划时，生成模型已有配置、其余基础设施未就绪。2026年10月3日Docker已可用，本任务已用隔离合成PostgreSQL/pgvector、Redis和专用测试配置运行集成测试；真实COS与Embedding仍未验收。实际结果见 [[docs/01-产品方案/可行动事务Agent-正式个人版开发验证|正式个人版开发验证]]；不把工程替身计作真实外部服务通过。
- 正文与UI中文；数据模型/授权/取消/删除/版本规则以技术合同为准。单文件10 MiB、40,000字符、PDF50页；每生成运行最多2次生成请求，查询Embedding最多1次批量；临时60分钟闲置、24小时硬期限。
- 不复制静态原型的流程脚本和预置人物/回答。只复用已声明来源的品牌素材，重新实现真实UI。

## Task 1: 目录迁移与MVP回归

**文件：** 将 `src/web/*` 移至 `front/src/`；前端package/lock、index、Vite、TypeScript、Playwright配置移至front；`src/server/*` 移至 `backend/fileaction/`；根后端测试移至backend/tests；tests/e2e与manual移至front/e2e与front/scripts；requirements/pyproject移至backend。空src/tests目录仅在验证无其他文件后移除。根README、AGENTS、CLAUDE、当前正式设计及总览更新有效路径，旧MVP证据/历史归档不改写。

**接口：** 后端包 `fileaction` 可在backend目录运行；前端npm命令在front运行；根 `.env` 定位不依赖cwd。保留迁移后MVP显式入口，后续正式入口另行切换。所有Python测试导入改为fileaction，同步e2e PYTHONPATH/backend、front/node_modules与构建路径。

- [ ] 确认备份完整，记录移动清单；执行原生路径移动，不覆盖目标、无git mv。
- [ ] 更新入口与导入：`cd backend; ../.venv/Scripts/python -m pytest tests -q`；`cd front; npm.cmd test -- --run`、typecheck、build。
- [ ] 执行迁移后的 `../.venv/Scripts/python front/e2e/run.py` 对应根路径命令，记录真实结果；不终止未知已有服务。
- [ ] 修复路径问题并读回报告；README只写已执行成功命令。报告不含密钥。
- [ ] 独立评审映射完整性、运行根目录和测试隔离，修复发现后记录完成。

## Task 2: 正式服务基础、配置与数据库合同

**文件：** 新建 `backend/fileaction/core/config.py`、`core/errors.py`、`api/application.py`、`db/session.py`、`db/models.py`、`backend/alembic.ini`、`backend/migrations/`、`backend/tests/formal/test_configuration.py`、`test_health.py`、`test_schema.py`、根 `compose.yaml` 与 `backend/Dockerfile`；正式入口使用新工厂。旧app.py暂留明确legacy入口 `python -m fileaction.legacy`，对应原MVP测试改为验证legacy入口，不能混用正式与旧CLI断言。

**接口：** `Settings.from_environment(env_file: Path | None)` 只加载白名单，进程优先且不插值；`create_app(settings: Settings, services=None) -> FastAPI` 不在import时访问云服务；`GET /api/v1/health/live`及ready返回安全状态。`ActorContext(user_id, session_id)`供领域服务使用；SQLAlchemy每操作独立事务，RLS身份事务局部。生成OpenAPI作为前端合同。

- [ ] 先写配置/隔离测试：缺PG配置不创建SQLite；显式空环境不被.env覆盖；API根路径不返回MVP页面；live不请求模型；ready在依赖缺失时503，不泄露DSN。

```python
def test_unconfigured_dependencies_are_explicit(client):
    assert client.get('/api/v1/health/live').status_code == 200
    response = client.get('/api/v1/health/ready')
    assert response.status_code == 503
    assert 'password' not in response.text.lower()
```

- [ ] 运行上述测试看到预期失败，再实现最小工厂、配置、错误信封和依赖接口。
- [ ] 添加PostgreSQL/pgvector迁移、受限runtime与dispatcher角色配置、组合外键/RLS和事务session。生成与Embedding维度须受显式配置/迁移验证，未配置时不假定向量维度。
- [ ] Compose提供PG/pgvector、Redis非持久实例、API、Worker和独立front服务；只暴露回环开发端口；云凭证不进入镜像。
- [ ] 离线合同测试与真实PG集成分开；未具备服务时真实集成明确skip和原因，不能用SQLite替代。

## Task 3: 账号、会话与多用户隔离

**文件：** `backend/fileaction/auth/`下service、routes、security；`backend/tests/formal/test_auth.py`、`test_isolation.py`及数据库集成测试。

**接口：** `/api/v1/auth/csrf|register|login|logout|me|profile|password|account`与设计第11节一致；Cookie身份、HttpOnly、SameSite=Lax，生产Secure；每个写请求CSRF/Origin检查，ActorContext来自验证后的会话。

- [ ] 先写注册/重复账号/错密码/CSRF失败/登出撤销/跨用户404/改密撤销测试，再实现Argon2id与摘要令牌存储。
- [ ] 服务层以repository接口隔离可单测逻辑，真实实现为PostgreSQL；测试内存替身只驻留tests，正式启动不启用。
- [ ] 在真实PG中验证角色/RLS、连接复用与组合外键；没有数据库则完整报告未验证范围。
- [ ] 检查匿名错误、日志和OpenAPI不会泄露密码、令牌或内部配置。

## Task 4: 文件、COS、临时生命周期与RAG索引

**文件：** `backend/fileaction/storage_adapters/`、`documents/`、`retrieval/`、`indexing/`；复用迁移后的parsers.py；测试 `test_documents.py`、`test_cos.py`、`test_retrieval.py`、`test_embedding.py`。使用storage_adapters名称，避免与旧MVP的storage.py冲突；旧schemas.py同样不被新同名包遮蔽，正式DTO放在各功能模块。

**接口：** 文件与索引API严格使用技术设计第11.3节；`CosBlobStore`与`TemporaryStore`按第8节；`EmbeddingGateway.embed(texts, profile, budget)`返回经维度/条数/有限值验证的向量；检索返回原片段引用而非伪造页码。

- [ ] RED覆盖未授权不外发、临时不上COS/PG、超限释放、COS失败补偿、解析/索引独立状态。
- [ ] 实现白名单格式解析与私有COS代理；不得提供任意URL抓取或任意桶访问。
- [ ] RED覆盖不同用户/文档版本/未授权片段排除、错误维度、混合召回、删除后迟到响应。
- [ ] 实现结构分块、pgvector精确检索、词面召回、RRF、索引预览与批次账本；临时索引只在Redis。
- [ ] 真实COS和Embedding测试使用独立显式开关和合成文件；缺配置明确未验证，正常服务不回放替身结果。

## Task 5: 工作区、Agent、Worker与可编辑成果

**文件：** `backend/fileaction/workspaces/`、`agent/`、`workers/`、`actions/`、`artifacts/`；测试 `test_workspaces.py`、`test_agent.py`、`test_runs.py`、`test_retention.py`、`test_exports.py`。

**接口：** 技术合同第5、7、9、10、11节；`AgentRunner.execute(run_id, lease)`通过明确图节点执行；RunContentStore按保存模式分流；API返回202与run_id，SSE传真实阶段而非未经校验答案。

- [ ] RED覆盖预览变更拒绝、幂等key冲突、取消/旧revision阻止提交、租约竞争、模型sent后崩溃不重发。
- [ ] 实现工作区消息/背景、Manifest、有限规划与只读工具；复用真实JSON模型适配并严格校验引用和事实类型。
- [ ] 实现PG队列、Worker租约、双存储提交、终态事件与查询，Redis丢失明确临时内容过期。
- [ ] RED覆盖保存快照不纳入晚到消息、独立背景保留、来源删除失效、用户编辑分版本与ZIP成员安全。
- [ ] 实现行动、成果、导出、保存补偿与精确删除；任何模型输出不能直接执行业务写操作。

## Task 6: 高保真正式前端与端到端连接

**文件：** `front/src/app/`、`features/auth|files|workspace|actions|deliverables|settings/`、`shared/`；各模块行为测试；`front/e2e/formal.spec.ts`。

**接口：** 消费已冻结的 `/api/v1` OpenAPI及技术设计DTO；React Router路由与TanStack Query缓存key包含user_id；默认同源代理API8000，后端不托管前端。

- [ ] 阅读原型暖白/金黄/细线/顶部导航/文件卡片/三栏工作区，先通过浏览器查看原型再用新React组件实现；无预填人物/材料/答案。
- [ ] RED验证登录错误、空文件空间、上传失败、授权选择、dirty编辑保护、退出清缓存和键盘抽屉；再接真实API客户端。
- [ ] 实现文件网格/列表、解析与索引状态、临时/保存选择、工作区对话/引用/沉淀、行动、成果版本/导出、设置；未配置服务显示真实错误。
- [ ] Playwright验证两账号核心链路、上传、失败、取消、引用、确认、编辑、导出；390/768/1440截图核对。HTTP替身场景清楚标记，仅用于工程流程测试。

## Task 7: 全量回归、真实服务验收与交付

**文件：** README、CLAUDE、开发验证记录、合成评测及运行脚本；不改写旧MVP测试历史。

- [ ] 执行后端单元/合同、前端组件/typecheck/build、PG/Redis/COS集成及浏览器检查；记录实际命令与结果，依赖缺失单列。
- [ ] 真实生成与Embedding按单独开关执行合成冒烟，30案例按技术设计统计召回/关注点，未执行不报告为通过。
- [ ] 独立全局评审所有权、授权、秘密管理、取消/竞态、数据保留、原型一致性与运行入口，修复实际缺陷后针对性复测。
- [ ] README只写实测入口，列出未配置或未验收项；不提交、不发布，不停止用户已有进程。

## 执行状态

任务及评审证据以本计划对应的SDD进度账本和 `.planning/2026-10-02-formal-development-1e4002ce/` 为准；代码阶段未完成不能标记为正式版完整交付。
