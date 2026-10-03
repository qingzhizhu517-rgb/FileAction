---
created: 2026-10-02
updated: 2026-10-02
status: 本地工程实施及验收完成；真实LLM、真人与公网未验收
---

# 可行动事务 Agent · 个人 MVP 实施计划

> 执行要求：使用 Superpowers 的 subagent-driven-development / executing-plans 工作方法逐任务实施，独立模块可按 dispatching-parallel-agents 分工；每个任务遵循 TDD。仓库规则覆盖技能默认提交建议，本次不提交、推送、合并或部署。

**目标**：实现用户已确认的本地个人文件解读闭环，保存与行动均由用户主动选择。

**架构**：React/TypeScript + Vite 前端，FastAPI 本机后端，SQLite 仅保存用户选择的背景。文件与解读保留在会话内存；模型通过服务端配置的兼容 Chat Completions JSON 接口调用。

**设计依据**：[[docs/01-产品方案/可行动事务Agent-个人MVP开发设计|个人 MVP 开发设计]]。用户在本次会话以“可以”确认。

## 1. 全局约束

- 中文界面；只监听回环地址；不提供公网部署。文件10 MiB，文本40,000字符，PDF50页，模型60秒超时，闲置会话60分钟清除。
- 无模型配置、超时、拒绝、非法JSON或伪造引用明确失败；无生产替身，无自动重试。
- 默认不外发、不长期保存、不起草；三个选择必须独立。允许零背景、跳过、只理解后结束。
- 文件/背景版本改变、取消、重置后迟到结果不得回填。背景停用删除影响所有使用该条目的本地会话。
- TXT/MD、文本PDF、DOCX逐项测试；DOCX段落/表格而非假页码。扫描件、图片、批注、修订不是完整支持范围。
- 旧Demo与归档不修改、不拷入产品；合成样例和测试替身明确标注。
- 修改前备份位于 `.planning/2026-10-02-personal-mvp-implementation-e24215c5/`。

## 2. 固定接口合同

非公开配置接口使用随机 `X-Session-ID`；`POST /api/session` 创建本地会话。所有变更返回 Session，模型与导出请求必须携带当前 `revision`。错误返回 `{"detail":"可理解的中文原因"}`，不得回显模型密钥或原文。

```typescript
type Segment = { id: string; locator: string; text: string };
type Document = { id: string; name: string; hash: string; segments: Segment[]; warnings: string[] };
type Fact = { id: string; text: string; source: string; version: number; memory_id: string | null };
type Citation = { segment_id: string; quote: string };
type Reading = {
  items: { title: string; meaning: string; kind: 'fact'|'inference'|'unknown'; citations: Citation[]; fact_ids: string[] }[];
  questions: { question: string; reason: string }[];
  unknowns: string[];
  candidates: { text: string; source_segment_ids: string[] }[];
};
type Artifact = { text: string; citations: Citation[]; fact_ids: string[] };
type Session = { id: string; revision: number; document: Document|null; facts: Fact[]; reading: Reading|null; artifact: Artifact|null; ended: boolean; busy: boolean };
type Memory = { id: string; text: string; source: string; version: number; active: boolean };
```

| 方法与路径 | 输入 | 输出 |
|---|---|---|
| GET /api/config | 无 | configured、provider、model、supported_formats、limits |
| POST /api/session | 无 | Session |
| GET /api/session | 会话头 | Session |
| POST /api/document?filename=... | 原始文件bytes，application/octet-stream | Session |
| POST /api/facts | text；可选source，服务端不能当作来源权限 | Session，已明确用于本次 |
| PATCH /api/facts/{id} | text | Session，旧结果失效 |
| DELETE /api/facts/{id} | 会话头 | Session |
| GET /api/memories | 会话头 | {items: Memory[]} |
| POST /api/memories | fact_id、consent:true | Memory |
| PATCH /api/memories/{id} | text或active | Memory |
| DELETE /api/memories/{id}?confirmed=true | 会话头 | {deleted:true} |
| POST /api/memories/{id}/use | 会话头 | Session |
| POST /api/interpret | revision、consent:true | Session |
| POST /api/artifact | revision、consent:true、goal | Session |
| PATCH /api/artifact | revision、text | Session |
| POST /api/export | revision | Markdown文件，包含已编辑正文、来源、未知和生成标识 |
| POST /api/cancel | 会话头 | Session，取消在途调用、阻止回填 |
| POST /api/reset | 会话头 | Session，清除文件/事实/结果 |
| POST /api/end | 会话头 | Session，清除本次内容且结束 |

模型结构与前端类型一一对应。事实类和推断类解读须至少有一个有效原文引用，引用文字必须在对应片段中。背景引用必须存在且已确认；候选沉淀不能自行入库。

## 3. 任务一：解析、来源与本地会话后端

文件：`src/server/parsers.py`、`schemas.py`、`storage.py`、`model.py`、`sessions.py`、`app.py`、`__main__.py`、`tests/test_parsers.py`、`test_model.py`、`test_api.py`、`.env.example`、`requirements.txt`。

- [x] 先创建测试：支持解析定位；空/乱码/超限/扫描件拒绝；DOCX压缩限制；未配置模型错误；确认不持久化；无外发同意拒绝；失效导出拒绝；取消迟到响应；Host/Origin拒绝与会话隔离。
- [x] 执行 `.venv/Scripts/python -m pytest tests -q` 记录因目标模块尚不存在而失败的红灯，然后为每项行为继续确认失败。
- [x] 实现解析与Pydantic输出校验，以本地输入断言检验真实逻辑：

```python
def test_line_locator():
    doc = parse_document('通知.txt', '合成通知\n截止：10月15日'.encode())
    assert doc.segments[1].locator == '第2行'
    assert doc.segments[1].text == '截止：10月15日'

def test_confirm_does_not_save(client, session_headers):
    client.post('/api/facts', headers=session_headers, json={'text':'合成背景：关注教育实习'})
    assert client.get('/api/memories', headers=session_headers).json() == {'items': []}
```

- [x] 模型配置读取 `FILEACTION_MODEL_BASE_URL`、`FILEACTION_MODEL_API_KEY`、`FILEACTION_MODEL_NAME`，服务端请求`/chat/completions`；按真实HTTP边界注入测试响应，禁止生产fallback。
- [x] API按第2节实现；处理最大会话数、TTL、任务取消、旧响应与跨会话记忆失效。原始上传使用流式上限读入内存，不使用落盘上传缓存。
- [x] 执行测试并记录真实命令、通过数与失败修复。

## 4. 任务二：个人端页面与交互

文件：`src/web/App.tsx`、`api.ts`、`types.ts`、`styles.css`、`main.tsx`、`App.test.tsx`，根`package.json`、`package-lock.json`、`vite.config.ts`、`tsconfig.json`、`index.html`。

- [x] 先写可见行为测试：初始无需档案；解析前不调用模型；未确认外发不能解读；服务错误展示；背景确认不保存；跳过问题；编辑下载使用实际编辑正文；旧响应忽略。
- [x] 执行 `npm test -- --run`，验证组件尚未实现或相关行为缺失导致失败。
- [x] 根据第2节合同实现客户端：

```typescript
const response = await fetch('/api/interpret', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', 'X-Session-ID': session.id },
  body: JSON.stringify({ revision: session.revision, consent: true }),
  signal: controller.signal,
});
if (!response.ok) throw new Error((await response.json()).detail);
```

- [x] 黄白品牌色、可访问标签、移动布局、原文展开与背景引用、本次候选确认、保存/停用/删除、主动生成和编辑导出。新增合成通知只提供输入。
- [x] 运行前端测试、TypeScript检查与生产构建；不得用仅toast替代下载。

## 5. 任务三：集成与审查

- [x] 运行后端全部测试和前端测试/构建；模型测试替身明确隔离。
- [x] 启动本机真实应用，通过浏览器上传合成TXT、错误文件、展开来源、确认背景/保存/删除/重置，检查未配置模型失败。
- [x] 测试环境下用明确标记的模型HTTP替身走完整交互和导出，再单独报告真实LLM是否可用。浏览器不能打开或模型未配置即如实记录。
- [x] 独立审查：对照同意边界、迟到响应、引用校验、输入限制、持久化和不可信渲染；修复后再跑覆盖测试。

## 6. 任务四：真实说明与交付

- [x] 仅在实际运行后更新README命令，更新CLAUDE/AGENTS/总览中“源码尚未存在”状态，不改变历史归档和旧来源日期。
- [x] 新增开发验证记录，标记真实模型/真人/公网未验收范围。
- [x] `git diff --check`、文档链接/标题/围栏、归档哈希与敏感文件检查，保留所有已有未跟踪工作。
- [x] 最终报告可运行入口、实测结果、需本地配置的模型环境变量；不自动提交部署。

## 7. 实际完成记录

2026年10月2日本地工程实施与独立审查完成。主任务实际回归：42项后端测试、12项前端测试、16项浏览器测试通过，类型检查与构建通过。真实模型配置三项均未设置，因此不报告真实LLM验收通过。运行命令、已修复问题、既有链接限制和未验收范围见 [[docs/01-产品方案/可行动事务Agent-个人MVP开发验证|个人 MVP 开发验证]]。未提交、推送、合并或部署。
