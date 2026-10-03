---
created: 2026-10-03
updated: 2026-10-03
status: 已实施；待用户验收
---

# 文件工作台界面改造实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将文件空间和正式分析工作区收敛为清晰的“上传/继续 → 开始理解 → 查看关系 → 决定下一步”路径，降低首屏文字和卡片噪音，同时保持现有后端行为。

**Architecture:** 复用现有 API、路由和工作区状态，仅调整 React 结构中的信息层级与 CSS。文件页把上传、最近工作区和文件库放进同一阅读入口；工作区保留材料、对话和背景三类数据，但让对话输入与解读结果成为视觉主层，低频说明通过折叠或次级操作呈现。

**Tech Stack:** React 19, React Router, TanStack Query, TypeScript, CSS, Vitest Testing Library。

---

### Task 1: 固化文件入口的主路径

**Files:**
- Modify: `front/src/features/files/FilesPage.test.tsx`
- Modify: `front/src/features/files/FilesPage.tsx`
- Modify: `front/src/features/home/files-entry.css`

- [x] **Step 1: Write the failing tests**

验证文件页使用“最近继续”作为临时会话入口，并以“上传一份文件”作为唯一主动作；示例体验仍保留但不再成为第二个宣传区。

- [x] **Step 2: Run the focused test and confirm the expected failure**

Run: `npm test -- --run src/features/files/FilesPage.test.tsx`
Expected: the new assertions fail because the current page still renders“最近阅读”and the large upload hero copy.

- [x] **Step 3: Implement the smallest layout change**

将上传 hero 改为短条入口，临时工作区标题改为“最近继续”，并在 CSS 中减少装饰背景、卡片内边距和管理操作的视觉权重；不修改上传请求、文件查询或工作区创建请求。

- [x] **Step 4: Run the focused test**

Run: `npm test -- --run src/features/files/FilesPage.test.tsx`
Expected: all file-page tests pass.

### Task 2: 聚焦正式分析首屏

**Files:**
- Modify: `front/src/features/workspace/WorkspacePage.test.tsx`
- Modify: `front/src/features/workspace/WorkspacePage.tsx`
- Modify: `front/src/features/workspace/reading-workspace.css`

- [x] **Step 1: Write the failing test**

验证示例工作区不再渲染“合成示例 · 真实模型解读”流程横幅，并验证“这份文件，对现在的你意味着什么？”和“开始理解”在工作区首屏结构中保持可见。

- [x] **Step 2: Run the focused test and confirm the expected failure**

Run: `npm test -- --run src/features/workspace/WorkspacePage.test.tsx`
Expected: the new absence assertion fails because `example-workspace-guide` currently renders for the example workspace.

- [x] **Step 3: Implement the smallest layout change**

移除示例流程横幅及对话区重复说明，压缩顶部操作为返回、文件名和低频操作区域；保留隐私确认、背景编辑和外发确认功能，通过现有组件和折叠详情承载低频信息。

- [x] **Step 4: Run the focused test**

Run: `npm test -- --run src/features/workspace/WorkspacePage.test.tsx`
Expected: all workspace tests pass.

### Task 3: 调整解读结果层级和响应式表现

**Files:**
- Modify: `front/src/features/workspace/reading-workspace.css`
- Test: `front/src/features/workspace/DocumentHighlights.test.tsx`

- [x] **Step 1: Run the existing result tests**

Run: `npm test -- --run src/features/workspace/DocumentHighlights.test.tsx`
Expected: existing extraction and source-display behavior remains green before styling changes.

- [x] **Step 2: Implement visual hierarchy**

让结果摘要、日期/链接、判断卡片、下一步选择形成单列阅读顺序；长历史和原文证据继续折叠；在 720px 以下将材料与背景区域变成连续的次级区块，并保持 44px 触控目标。

- [x] **Step 3: Run result tests and typecheck**

Run: `npm test -- --run src/features/workspace/DocumentHighlights.test.tsx && npm run typecheck`
Expected: exit code 0。

### Task 4: 浏览器验收与提交

**Files:**
- No additional product files.

- [x] **Step 1: Build and run the full frontend test suite**

Run: `npm test -- --run && npm run build`
Expected: all tests pass and Vite build exits 0。

- [x] **Step 2: Use the running app to verify the real path**

Open `/files`, confirm upload and recent-workspace actions; open a workspace, confirm the first actionable question is visible without the former guide banner, then verify the result view still exposes sources and the next-step decision.

- [x] **Step 3: Check the diff and commit only this UI batch**

Run: `git diff --check` and `git status --short`.
Commit message: `refactor: simplify file workspace flow`。

## 实际验收记录

- 2026年10月3日：`front/` 运行 `npm test -- --run`，21 个测试文件、123 条测试通过；`npm run build` 成功；仓库根目录 `git diff --check` 通过。
- 浏览器查看了文件页、管理员示例入口和工作区首屏；此前使用合成 PDF 走通上传确认、真实模型解读、来源查看和继续行动。合成内容仅用于验收，不代表真实用户案例。
- 上传、文件查询、工作区创建、模型调用和外发确认仍调用原有接口；本轮界面调整没有修改这些请求的后端处理逻辑。
