# 文启对话流程重做实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将正式版事务工作区改为“先理解文件对用户的意义，再由用户选择是否行动”的文档与高保真原型流程。

**Architecture:** 保留现有工作区、预览、后台运行和成果接口作为底层能力；前端把技术控制项收进确认层，首屏改成对话式解读，解读结果先展示发现、依据、未知和可跳过问题，再显示继续行动入口。沉淀以工作区内抽屉呈现，确认用于本次与长期保留分开处理。

**Tech Stack:** React 19、TypeScript、React Router、TanStack Query、FastAPI、PostgreSQL/Redis、现有真实模型 Worker。

**Spec:** `docs/01-产品方案/可行动事务Agent-参赛主线方案.md`、`docs/01-产品方案/可行动事务Agent-正式个人版架构与交互设计.md`、`docs/05-交互Demo/可行动事务Agent-文启高保真Demo.html`

## Global Constraints

- 首屏文案围绕“这份文件对现在的你意味着什么”，不要求先填写个人档案。
- 文件事实、用户确认背景、系统推断、未知必须分开展示，并可回到原文引用。
- 用户可以跳过问题、只完成理解、不保存、不继续行动。
- 外发范围确认仍必须真实存在，但不作为首屏技术操作项。
- 生成成果只能在用户明确选择继续行动后出现；成果是可编辑草稿，不代表已提交。
- 原型中的人物、奖学金、材料和结果只能作为合成示例，不能写入正式默认数据。
- 每项行为必须有失败、取消、过期和来源失效状态；不使用固定答案冒充模型结果。

---

### Task 1: 首轮事务对话体验

**Files:**
- Modify: `front/src/features/workspace/WorkspacePage.tsx`
- Modify: `front/src/features/workspace/workspace-run.css`
- Test: `front/src/features/workspace/WorkspacePage.test.tsx`

**Interfaces:**
- Consumes: existing `Workspace`, `ContextPreview`, `WorkspaceMessage`, `useWorkspaceRun`.
- Produces: first-screen conversation with a single natural-language question, hidden retrieval mode, and an explicit “开始理解” action that opens the existing preview confirmation.

- [ ] Write a failing test asserting the empty workspace shows “这份文件，对现在的你意味着什么？” and does not show “检索方式” or “本次请求” controls.
- [ ] Run `npm.cmd --prefix front test -- --run src/features/workspace/WorkspacePage.test.tsx` and confirm the new assertion fails.
- [ ] Replace the technical selector block with a conversation intro, optional goal prompt, and a single composer action labelled “开始理解”。
- [ ] Keep the existing preview API request but derive `kind='interpret'` and `retrieval_mode` internally; expose advanced retrieval only in a secondary failure/retry path.
- [ ] Add visible empty, loading, failed, cancelled and expired states matching the product language.
- [ ] Run the focused test and `npm.cmd --prefix front run typecheck`.

### Task 2: 解读结果与依据层级

**Files:**
- Modify: `front/src/features/workspace/AnswerResult.tsx`
- Modify: `front/src/features/workspace/WorkspacePage.tsx`
- Test: `front/src/features/workspace/WorkspacePage.test.tsx`

**Interfaces:**
- Consumes: existing answer envelope claims, evidence refs, unknowns, questions and action candidates.
- Produces: sections labelled “与你有关的发现”“原文依据”“仍需核实”“需要你补充吗”，with skip/correct actions.

- [ ] Add tests for document facts, confirmed facts, inference and unknown rendering, including an expandable citation.
- [ ] Render evidence beside each claim instead of presenting a flat generated answer first.
- [ ] Render questions only when returned by the model, with “补充”和“跳过” actions; skip must not block current result.
- [ ] Add a clear “到这里就够了” action that leaves the workspace without creating an action or artifact.
- [ ] Verify focused tests and browser DOM state.

### Task 3: 本次对话沉淀抽屉

**Files:**
- Modify: `front/src/features/workspace/WorkspacePage.tsx`
- Modify: `front/src/features/workspace/workspace-run.css`
- Test: `front/src/features/workspace/WorkspacePage.test.tsx`

**Interfaces:**
- Consumes: workspace goal, confirmed facts, candidate facts, unknowns and action candidates.
- Produces: drawer with separate “仅本次使用” and “确认保留” operations, using existing memory routes where available.

- [ ] Test that opening “本次对话沉淀” exposes goal, confirmed background, pending unknowns and source labels.
- [ ] Test that closing the drawer does not save anything.
- [ ] Wire “仅本次使用” to close the drawer without a persistence request.
- [ ] Wire selected confirmed facts to the existing retain endpoint only after explicit confirmation.
- [ ] Show retained, pending and unknown items with distinct labels.

### Task 4: 用户选择后的行动入口

**Files:**
- Modify: `front/src/features/workspace/WorkspacePage.tsx`
- Modify: `front/src/features/actions/ConfirmActionSuggestions.tsx`
- Test: `front/src/features/workspace/WorkspacePage.test.tsx`

**Interfaces:**
- Consumes: action candidates from a successful interpret run.
- Produces: explicit “继续行动” branch; action suggestions and artifact generation are hidden until selected.

- [ ] Test that a successful interpretation does not immediately show artifact generation controls.
- [ ] Add “继续行动” and “暂不行动” controls after the interpretation result.
- [ ] On “继续行动”, reveal action candidates and the existing confirmation component.
- [ ] Keep external submission absent; actions remain proposals requiring confirmation.

### Task 5: 成果页与流程回退

**Files:**
- Modify: `front/src/features/deliverables/DeliverablesPage.tsx`
- Modify: `front/src/features/workspace/WorkspacePage.tsx`
- Test: `front/src/features/deliverables/DeliverablesPage.test.tsx`

**Interfaces:**
- Consumes: artifact run created after explicit action selection.
- Produces: editable draft view with source audit, history/expired labels and return-to-conversation action.

- [ ] Test that direct navigation without an artifact shows a clear “先完成理解并选择行动” state.
- [ ] Ensure artifact creation keeps the confirmed facts and source references from the interpretation.
- [ ] Add return action that preserves the workspace conversation and does not silently regenerate.

### Task 6: Browser verification and documentation

**Files:**
- Modify: `README.md`
- Create: `.planning/2026-10-03-conversation-flow-redesign/verification.md`

- [ ] Run focused frontend tests, typecheck and `git diff --check`.
- [ ] Start the existing local API, generation worker and Vite frontend without stopping unrelated services.
- [ ] In the browser verify upload, first interpretation, citation expansion, skip question, open/close sediment drawer, “到这里就够了”, “继续行动”, artifact edit and return to conversation.
- [ ] Record actual commands, results and remaining limitations in the verification file.
