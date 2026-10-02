# 后端 MVP Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 实现一个本机运行、使用真实 LLM 的个人端文件理解后端，交付有原文依据的个性化解读、显式保留的沉淀和用户选择后的可编辑产物。

**Architecture:** Node.js 内置 HTTP 服务按职责拆分为配置、文件解析、模型适配、结果校验、状态服务和本地存储。模型适配器只负责真实调用，确定性模块负责状态、引用、授权和导出；本地运行数据写入已忽略的 `var/`。

**Tech Stack:** Node.js 18+、ES modules、`node:test`、内置 `fetch`、`node:crypto`、`node:http`、`node:fs/promises`。运行时零第三方依赖。

**Spec:** `docs/01-产品方案/可行动事务Agent-后端MVP设计规格.md`

## Global Constraints

- 首版只接受 UTF-8 `.txt` 和 `.md`，单文件最大 `1048576` 字节。
- 服务只绑定 `127.0.0.1`，默认端口 `8788`。
- 模型环境变量为 `LLM_BASE_URL`、`LLM_API_KEY`、`LLM_MODEL`、`LLM_TIMEOUT_MS`；`LLM_BASE_URL` 是完整的 OpenAI 兼容 `chat/completions` 地址，默认超时 `30000` 毫秒。
- 不引入第三方运行时依赖；不提交 `.env`、`var/`、上传正文、密钥或完整模型响应。
- 模型未配置、失败、超时或返回无效结果时返回规格定义的错误，不调用预置回答。
- 每次产品行为变更按 TDD 执行：先写失败测试并确认失败，再实现，再通过，最后回归。
- 未经用户明确授权不 commit、push、merge、部署或发送真实敏感材料。
- 真实 LLM 验收必须使用脱敏合成样例并记录实际模型、日期、状态和未验证范围。

## Review Focus

- 模型返回非 JSON、引用不存在或行号错误：返回 502，不展示无法核验的发现。Owner: Task 3。
- 模型未配置、网络失败或超过 30 秒：分别返回 503、504，不静默降级。Owner: Task 3。
- 回答问题或跳过问题被误认为长期保存：只更新本次解读，不创建记忆。Owner: Task 4。
- 用户未选择继续却被生成产物：返回 409，只有显式 `choice: "continue"` 才能调用产物模型。Owner: Task 4。
- 超限、非 UTF-8 或错误媒体类型上传造成部分写入：在创建 `documentId` 前返回 400/413，存储中不留下记录。Owner: Tasks 2、5。

---

### Task 1: 服务骨架与模型配置状态

**Files:**
- Create: `package.json`
- Create: `src/config.js`
- Create: `src/logger.js`
- Create: `src/server.js`
- Test: `tests/config.test.js`
- Test: `tests/server.test.js`

**Interfaces:**
- Produces: `loadConfig(env: NodeJS.ProcessEnv) -> {host: "127.0.0.1", port: number, dataDir: string, llm: {configured: boolean, baseUrl: string|null, apiKey: string|null, model: string|null, timeoutMs: number}}`
- Produces: `createLogger(sink: (line: string) => void) -> {info(event: object): void, error(event: object): void}`
- Produces: `startServer(options?: {port?: number, dataDir?: string, env?: object, modelClient?: object}) -> Promise<{server, baseUrl, close(): Promise<void>}>`
- Consumes: 仅 Node.js 内置模块。

- [ ] **Step 1: 写失败测试**

`tests/config.test.js` 中新增 `loadConfig` 测试：默认 host 为 `127.0.0.1`、port 为 `8788`、timeout 为 `30000`；三个模型变量齐全时形成配置；缺任一模型变量时 `llm.configured === false`；非法端口或超时抛出带字段名的错误；配置对象不包含日志输出方法。

`tests/server.test.js` 中新增：启动后 `GET /api/status` 返回 `{status:"ok", supportedFormats:["text/plain","text/markdown"], maxBytes:1048576, modelConfigured:false, bindHost:"127.0.0.1"}`；响应不包含 `LLM_API_KEY`；未知路径返回 404；日志行不包含 API key。

- [ ] **Step 2: 运行测试确认失败**

Run: `node --test tests/config.test.js tests/server.test.js`
Expected: FAIL，原因是模块或服务尚不存在。

- [ ] **Step 3: 实现配置、日志和状态服务**

在 `src/config.js` 实现 `loadConfig`；在 `src/logger.js` 实现结构化但不含正文与密钥的日志；在 `src/server.js` 实现 `startServer`，仅绑定 `127.0.0.1`，注册 `/api/status` 与 404。`package.json` 使用 `"type":"module"`，脚本为 `"start":"node src/server.js"`、`"test":"node --test tests/*.test.js"`。

- [ ] **Step 4: 运行测试确认通过**

Run: `node --test tests/config.test.js tests/server.test.js`
Expected: PASS，0 failed。

### Task 2: 文件解析与引用定位

**Files:**
- Create: `src/document.js`
- Test: `tests/document.test.js`

**Interfaces:**
- Consumes: Task 1 的 `maxBytes = 1048576` 与支持媒体类型。
- Produces: `parseDocument(input: {filename: string, mediaType: string, text: string, maxBytes?: number}) -> {id: string, filename: string, mediaType: "text/plain"|"text/markdown", text: string, bytes: number, lines: string[], sha256: string}`
- Produces: `lineText(document, lineStart: number, lineEnd: number): string`
- Produces: `DocumentError extends Error`，具有 `code: "invalid_format"|"too_large"|"invalid_encoding"`。

- [ ] **Step 1: 写失败测试**

`tests/document.test.js` 覆盖：正常 TXT 和 Markdown 解析并保留 BOM 后文本；空行行号稳定；`lineText` 精确返回第 1 行和跨行片段；扩展名与 mediaType 不匹配返回 400 对应的 `invalid_format`；超过 `1048576` 字节返回 `too_large`；包含 NUL 或代理对损坏的文本返回 `invalid_encoding`；相同内容生成相同 sha256 但 id 不重复。

- [ ] **Step 2: 运行测试确认失败**

Run: `node --test tests/document.test.js`
Expected: FAIL，原因是 `src/document.js` 尚不存在。

- [ ] **Step 3: 实现 `parseDocument`、`lineText` 与 `DocumentError`**

按签名实现扩展名、媒体类型、字节上限和 UTF-8 文本校验；使用 `crypto.randomUUID()` 生成 id，使用 `sha256` 计算内容摘要。行号定义为 1 基，行数组保留空字符串。

- [ ] **Step 4: 运行测试确认通过**

Run: `node --test tests/document.test.js`
Expected: PASS，0 failed。

### Task 3: 真实模型适配器与结构校验

**Files:**
- Create: `src/model.js`
- Create: `src/model-schema.js`
- Test: `tests/model.test.js`
- Test: `tests/model-schema.test.js`
- Create: `scripts/llm-smoke.mjs`

**Interfaces:**
- Consumes: Task 1 的模型配置与 Task 2 的 `lineText`。
- Produces: `createModelClient(config.llm, fetchImpl = globalThis.fetch) -> {interpret(request: {document, background, previousAnswers, timeoutSignal?}): Promise<InterpretationResponse>, draft(request: {document, interpretation, artifactType, timeoutSignal?}): Promise<DraftResponse>}`
- Produces: `ModelError extends Error`，具有 `code: "not_configured"|"timeout"|"network"|"invalid_response"` 和 `httpStatus: 503|504|502`。
- Produces: `validateInterpretation(raw: unknown, input: {document, background}): InterpretationResponse`
- Produces: `validateDraft(raw: unknown, interpretation): DraftResponse`

- [ ] **Step 1: 写模型失败与成功测试**

`tests/model.test.js` 使用明确标记的 mock fetch：未配置抛出 `not_configured/503`；HTTP 非 2xx 抛出 `network/504`；AbortController 超时抛出 `timeout/504`；请求体包含文档、背景、既往回答和严格 JSON 指令；不把 API key 放入请求体或错误消息。

`tests/model-schema.test.js` 覆盖：合法解读通过；`findings` 为空时仍通过但必须保留 `unknowns`；引用 quote 不在原文、行号越界、跨行文本不匹配、缺少 `kind` 或 `uncertainty` 时抛 `invalid_response/502`；背景 id 不在本次输入时拒绝；产物必须包含 `draft`、`usedConfirmedInfo`、`pendingItems` 和 `disclaimer`。

- [ ] **Step 2: 运行测试确认失败**

Run: `node --test tests/model.test.js tests/model-schema.test.js`
Expected: FAIL，模型模块尚不存在。

- [ ] **Step 3: 实现模型客户端和确定性校验**

`src/model.js` 使用内置 `fetch` 调用 `LLM_BASE_URL`，默认超时 `30000`，解析 OpenAI 兼容响应的 `choices[0].message.content` 后再交给 schema 校验。`src/model-schema.js` 不信任模型行号，必须用 `document.lines` 重新验证 quote。`scripts/llm-smoke.mjs` 只读取脱敏合成文本，调用一次真实模型并输出状态与模型名，不输出正文或密钥。

- [ ] **Step 4: 运行测试确认通过**

Run: `node --test tests/model.test.js tests/model-schema.test.js`
Expected: PASS，0 failed。

- [ ] **Step 5: 检查未配置烟测的失败路径**

Run: `env -u LLM_BASE_URL -u LLM_API_KEY -u LLM_MODEL node scripts/llm-smoke.mjs`
Expected: 退出码非 0，明确输出 `not_configured`，不输出密钥。

### Task 4: 解读、沉淀与产物状态服务

**Files:**
- Create: `src/store.js`
- Create: `src/service.js`
- Test: `tests/store.test.js`
- Test: `tests/service.test.js`

**Interfaces:**
- Consumes: Task 2 的 document 数据与 Task 3 的 model client。
- Produces: `createStore(dataDir: string) -> {createDocument(doc), getDocument(id), createInterpretation(value), getInterpretation(id), updateInterpretation(id, updater), createMemory(value), listMemories(), getMemory(id), deleteMemory(id), createArtifact(value), getArtifact(id)}`，所有方法为 Promise。
- Produces: `createService({store, modelClient, now?: () => Date}) -> {interpret({documentId, background?, previousAnswers?}), answer({interpretationId, question, answer|null, skipped}), retainMemory({interpretationId, content, retain}), deleteMemory(id), createArtifact({interpretationId, choice, artifactType}), exportArtifact(id, format)}`

- [ ] **Step 1: 写存储失败测试**

`tests/store.test.js` 使用临时目录：创建后可读取；未知 id 抛 404 风格 `StoreError`；并发写入不覆盖；删除后读取返回 404；`var` 数据内容不包含模型配置密钥。测试目录在 teardown 后删除。

- [ ] **Step 2: 写状态服务失败测试**

`tests/service.test.js` 使用明确标记的 fake model client：不存在的文档返回 404 风格错误；模型 `ModelError` 原样保留状态码，且失败记录状态为 `failed`；成功 `interpret` 产生状态 `interpreted`；失败后 `answer` 返回 409；`answer` 只更新本次解读且 `listMemories()` 仍为空；`retainMemory` 在 `retain:false` 或缺失时拒绝且不写入，在 `retain:true` 时写入一次；重复保留同一 interpretation 返回既有记忆；删除后不可读取；`createArtifact` 在没有 `choice:"continue"` 时返回 409，选择后调用模型并生成状态 `editable` 的产物；Markdown 导出包含来源、已确认信息、待确认项和“不代表资格通过/已发送”。

- [ ] **Step 3: 运行测试确认失败**

Run: `node --test tests/store.test.js tests/service.test.js`
Expected: FAIL，模块尚不存在。

- [ ] **Step 4: 实现 `StoreError`、原子 JSON 存储和 `createService`**

存储文件使用 `documentId/interpretationId/memoryId/artifactId` 命名，写入采用临时文件加 rename；服务维护单会话写队列，确保更新不互相覆盖。状态转换只允许 `uploaded -> interpreting -> interpreted|failed` 与产物 `editable`，不根据模型内容自动推进保存或对外操作。

- [ ] **Step 5: 运行测试确认通过**

Run: `node --test tests/store.test.js tests/service.test.js`
Expected: PASS，0 failed。

### Task 5: HTTP API 与错误映射

**Files:**
- Modify: `src/server.js`
- Test: `tests/api.test.js`

**Interfaces:**
- Consumes: Task 1 的 `startServer`、Task 4 的 `createService`，通过依赖注入替换 model client。
- Produces: `startServer({port?, dataDir?, env?, modelClient?})` 提供规格中的全部路由。

- [ ] **Step 1: 写 API 失败测试**

`tests/api.test.js` 对临时服务器断言：`POST /api/documents` 正常返回 documentId；空/错格式返回 400；超过 1048576 字节返回 413 且存储无记录；未配置模型调用 `/api/interpretations` 返回 503；fake 模型成功返回结构化发现；fake 模型返回坏引用返回 502；fake 模型超时返回 504；回答不创建记忆；显式保留后可列出并删除；未继续返回 409，继续后可导出 Markdown；未知顶层字段返回 400；JSON 错误体统一为 `{error:{code,message,requestId}}`，响应和日志不含正文、背景或密钥。

- [ ] **Step 2: 运行测试确认失败**

Run: `node --test tests/api.test.js`
Expected: FAIL，因为路由尚未接入服务。

- [ ] **Step 3: 实现路由、请求大小限制和错误映射**

依次实现 `GET /api/status`、`POST /api/documents`、`POST /api/interpretations`、`POST /api/interpretations/:id/answers`、`POST /api/memories`、`DELETE /api/memories/:id`、`POST /api/artifacts`、`GET /api/artifacts/:id/export`。请求体在读取超过 1048576 字节时立即中止；未知字段不静默采用。

- [ ] **Step 4: 运行全部测试**

Run: `node --test tests/*.test.js`
Expected: PASS，0 failed。

### Task 6: 本地启动与真实模型验收

**Files:**
- Modify: `README.md`
- Test: `tests/api.test.js`
- Create: `.planning/2026-10-03-backend-mvp-verification/commands-and-results.md`（只记录真实运行结果）

**Interfaces:**
- Consumes: 前五项任务完成后的 CLI、HTTP API 和真实模型配置。
- Produces: 已实测的根目录启动、测试和烟测命令。

- [ ] **Step 1: 写根目录入口测试**

在 `tests/api.test.js` 增加启动脚本验证：以临时端口和临时 dataDir 执行 `node src/server.js`，等待 `/api/status`，请求成功后终止进程；断言退出码为 0 且没有写入仓库跟踪目录。

- [ ] **Step 2: 运行测试确认失败再通过**

Run: `node --test tests/api.test.js`
Expected: 先 FAIL（缺少 CLI 环境入口或启动行为），实现最小入口后 PASS。

- [ ] **Step 3: 实测基础命令并记录真实输出**

Run:
```sh
node --test tests/*.test.js
git diff --check
env -u LLM_BASE_URL -u LLM_API_KEY -u LLM_MODEL node scripts/llm-smoke.mjs
```
Expected: 测试与 diff 检查通过；未配置烟测按 Task 3 预期失败。将实际输出写入新的 `.planning/2026-10-03-backend-mvp-verification/commands-and-results.md`，不改写既有快照。

- [ ] **Step 4: 仅在用户已提供真实配置时执行真实 LLM 验收**

Run: `LLM_BASE_URL=... LLM_API_KEY=... LLM_MODEL=... node scripts/llm-smoke.mjs`
Expected: 真实调用成功并核对引用；若未配置、失败或超时，按真实结果记录，不写成通过。不在记录中保存密钥、文件正文或完整响应。

- [ ] **Step 5: 更新 README**

仅写入步骤 3 已实测的 `node --test tests/*.test.js` 和 `npm start`；说明首版格式、模型环境变量、本地绑定与真实模型未验收状态。修改前备份 README 和路径清单到全新 `.planning/日期-任务/`。

- [ ] **Step 6: 最终回归**

Run:
```sh
node --test tests/*.test.js
git diff --check
rg -n 'LLM_API_KEY|BEGIN (RSA|OPENSSH|EC) PRIVATE KEY|ghp_' --glob '!*.md' --glob '!.planning/**' .
```
Expected: 测试通过、diff 无空白错误、代码与运行文件不包含密钥。README 中只保留实际验证过的命令。

## 完成定义

- 所有任务测试与最终回归通过。
- 真实 LLM 调用有配置时完成核验；无配置时如实标记未验证。
- 浏览器流程未接入时不声称完成浏览器验收。
- 未获授权不提交、不推送、不部署。
