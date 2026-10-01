---
tags:
  - 项目/可行动事务Agent
  - 黑客松
  - UI规格
created: 2026-09-23
updated: 2026-09-23
status: 阶段稿
---

# 可行动事务 Agent · UI 原型规格表（开发级）

> **文档用途**：本文件可直接交给 Claude Code / Cursor 作为开发依据。
> 每屏固定 9 个维度：屏幕布局 → 组件 → 真实数据 → AI 输出 → 动效 → 用户操作 → 后端实现 → 可 Mock → 评委看懂什么。
> 配套：[[可行动事务Agent-产品定义]] · [[可行动事务Agent-Demo状态表]]

---

## 〇、技术栈建议

| 层 | 建议 | 理由 |
|----|------|------|
| 前端 | **Next.js（App Router）+ Tailwind** | 一个仓库同时装前后端，API Route 免独立部署，72h 风险最低 |
| PDF 渲染 | **pdf.js**（文本层 + 高亮） | 需要文本层做高亮定位，非纯图表库 |
| 后端 | Next.js API Route（Node） | 省掉 Spring Boot 的启动成本 |
| 数据 | **JSON 文件 / SQLite** | Demo 不需要真数据库。预置 Context 直接读 JSON |
| LLM | 任意支持 **JSON Mode / function calling** 的模型 | 见第三节架构决策 |

> 如果团队更熟 Java：Spring Boot + Vue3 也可，但**预留半天配环境**。72h 里环境问题最贵。

---

## 一、核心架构决策（先定这个，再写代码）

### 决策：**LLM 只做「归一化」，规则引擎做「判定」**

```
自然语言条款  ──[LLM]──▶  结构化条件  ──[纯代码规则]──▶  判定结果
"成绩排名前10%"          {key:"gpa_rank",        SATISFIED /
                          op:"<=", value:10}     MISSING / UNKNOWN / CONFLICT
```

**为什么必须这样分**：

| 若让 LLM 直接判定 | 后果 |
|---|---|
| 结果不可复现 | Demo 现场跑两次结论可能不同 → 当场翻车 |
| 无法举证 | 「AI 觉得你符合」不能说清依据 → 证据链做不出来 |
| 幻觉污染 | 会编造不存在的获奖记录 → 触碰学术诚信红线 |

**而「归一化」是 LLM 最擅长的**（自然语言 → 结构化字段），出错也只是抽错字段，能被下一层的规则与人工确认拦住。

> **一句话**：LLM 负责「读懂条件」，代码负责「判定是否满足」。这条线一旦混，D 屏和 E 屏都做不出来。

---

## 二、数据模型（字段级）

### 2.1 Transaction —— 事务卡

```jsonc
{
  "id": "txn_001",
  "title": "国家奖学金申请",
  "type": "opportunity",              // obligation | opportunity
  "deadline": "2026-10-10",           // ISO date | null
  "deadline_raw": "请于10月10日17:00前提交",
  "submit_to": "辅导员办公室",
  "submit_to_raw": "交至各年级辅导员",
  "eligibility": [ /* Condition[] */ ],
  "materials":   [ /* MaterialItem[] */ ],
  "source": { "file": "评审通知.pdf", "page": 1 },
  "confidence": 0.92,
  "extracted_at": "2026-09-23T09:30:00+08:00"
}
```

### 2.2 Condition —— 条件（**必须带原文定位**）

```jsonc
{
  "id": "cond_01",
  "key": "gpa_rank",                 // 必须命中受控词表（见第四节）
  "label": "成绩排名要求",
  "kind": "threshold",               // threshold | boolean | enum | existence
  "operator": "<=",
  "value": 10,
  "unit": "名内",                    // 可选
  "scope": "single",                 // single | total | category
  "required": true,
  "raw_quote": "学习成绩排名位于本专业前10名",
  "source_span": { "page": 2, "quote": "学习成绩排名位于本专业前10名" },
  "source_doc": "评审通知.pdf",
  "confidence": 0.95
}
```

> **`scope` 字段说明**：当场景存在**多约束叠加**时必须有此字段（如学分场景的「总量约束 + 分类约束」）。
> `total` = 总量约束，`category` = 分类约束，`single` = 普通单条件。
> **缺了它就算不出「总量达标但某一类不达标」这类核心结论。**

> ⚠️ **`source_span.quote` 是本项目最重要的字段。** 没有它，C 屏的「点击条件 → 原文高亮」就做不出来，证据链从第一屏就断了。

### 2.3 MaterialItem —— 材料项

```jsonc
{
  "id": "mat_01",
  "name": "国家奖学金申请表",
  "required": true,
  "status": "TO_UPLOAD",             // FOUND | TO_FILL | TO_UPLOAD
  "format_hint": "学校统一模板，A4 双面",
  "template_ref": null,              // 模板文件 id | null
  "source_quote": "提交《国家奖学金申请表》一份"
}
```

### 2.4 UserFact + Evidence —— 个人上下文与证据

```jsonc
// UserFact
{
  "id": "fact_gpa_rank",
  "key": "gpa_rank",                 // ⚠️ 必须与 Condition.key 同一套词表
  "label": "专业排名",
  "value": 8,
  "type": "number",
  "evidence_id": "ev_003",
  "updated_at": "2026-09-23"
}

// Evidence
{
  "id": "ev_003",
  "fact_id": "fact_gpa_rank",
  "source_file": "2025-2026学年成绩单.pdf",
  "source_loc": "第 2 页 · 排名栏",
  "snippet": "专业排名：8 / 40",
  "verified": true                   // 用户是否确认过
}
```

> **关键设计**：`Condition.key` 与 `UserFact.key` **必须共用同一套受控词表**。否则匹配无法自动进行，D 屏只能退回 LLM 语义猜——那正是我们要避免的。

### 2.5 MatchResult —— 匹配判定

```jsonc
{
  "id": "match_01",
  "condition_id": "cond_01",
  "status": "SATISFIED",             // SATISFIED | MISSING | UNKNOWN | CONFLICT
  "matched_fact_id": "fact_gpa_rank",
  "evidence_id": "ev_003",
  "reason": "条件要求排名 ≤10，你的排名为 8，满足",
  "confidence": "high",
  "adjudicated_by": "rule"           // rule | llm | human
}
```

**四种状态必须区分清楚**（这是 Gap 面板立体度的来源）：

| 状态 | 判定规则 | Demo 中的表现 |
|------|---------|--------------|
| `SATISFIED` | 有事实且有证据，达标 | ✓ |
| `CONFLICT` | 有事实但**不达标**（如实践 12h < 要求 30h） | ⛔ 有但不满足 |
| `MISSING` | **无对应事实，且缺的是一份可准备的材料**（`requires_material: true`） | ⚠ 缺失 |
| `UNKNOWN` | **无对应事实，且无法自动判定**（需线下核实 / 条款含糊） | ? 待人工确认 |

> 只做 SATISFIED / MISSING 两种，Gap 面板会很平。**CONFLICT 和 UNKNOWN 才是让评委觉得「它真的在判断」的地方。**

> ⚠️ **`MISSING` 与 `UNKNOWN` 的区分靠 `Condition.requires_material` 布尔字段**：
> 能说清"缺哪份材料"→ `MISSING`（可行动）；说不清、只能线下确认 → `UNKNOWN`（诚实边界）。

> ⚠️ **另有一条易错点**：`MaterialItem` **不得混入 `Condition[]` 参与 readiness 计算**。材料清单是独立数据，只通过 `linkedTo` 关联条件。若把"提交材料"当成一条 Condition，readiness 分母会被污染，且四态统计会失真。

### 2.6 Gap —— 缺口（**纯聚合，零 LLM**）

```jsonc
{
  "transaction_id": "txn_001",
  "total": 5,
  "satisfied": [ /* MatchResult */ ],
  "missing":   [ /* MatchResult */ ],
  "conflict":  [ /* MatchResult */ ],
  "unknown":   [ /* MatchResult */ ],
  "missing_materials": [ /* MaterialItem: TO_FILL / TO_UPLOAD */ ],
  "readiness": 0.6                   // = 已满足条件数 / 总条件数，可算准
}
```

> **`readiness` 替代了被删掉的「预计准备时间 3 小时」**——它是**算出来的**，不是估出来的。任何可算准的数字都值得展示，任何估不准的都别放。

### 2.7 ActionPlan / MaterialPack —— 行动与材料包

```jsonc
// ActionStep（F 屏执行日志）
{
  "id": "step_03",
  "order": 3,
  "verb": "整理",                    // 只允许：整理 | 归档 | 校对 | 匹配
  "object": "获奖证明",
  "status": "done",                  // pending | running | done | failed
  "result_ref": "ev_007"
}

// MaterialPack
{
  "id": "pack_001",
  "items": [
    { "slot": "01", "name": "申请表",     "status": "TO_FILL",   "evidence_ref": null },
    { "slot": "02", "name": "成绩证明",   "status": "FOUND",     "evidence_ref": "ev_003" },
    { "slot": "03", "name": "获奖证明",   "status": "FOUND",     "evidence_ref": "ev_007" },
    { "slot": "05", "name": "个人事迹材料","status": "TO_FILL",   "evidence_ref": null, "warning": "无来源，需用户补充" }
  ],
  "confirmed": false
}
```

> `verb` 的**白名单**是产品态度的体现：只能**整理 / 归档 / 校对 / 匹配**。❌ 不许出现「生成」「编写」——那是学术诚信红线。

---

## 三、受控词表（Demo 最小集）

奖学金场景够用即可，不要扩。

| key | label | kind | 取值 |
|-----|-------|------|------|
| `applicant_type` | 学生类别 | enum | 本科生 / 专科生 / 研究生 |
| `grade_year` | 年级 | enum | 大一 / 大二 / 大三 / 大四 |
| `gpa` | 学分绩点 | threshold | number |
| `gpa_rank` | 专业排名 | threshold | number |
| `comprehensive_score` | 综合测评 | threshold | number |
| `no_fail` | 无挂科 | boolean | true / false |
| `no_discipline` | 无违纪 | boolean | true / false |
| `award_exists` | 获奖经历 | existence | true / false |
| `award_level` | 获奖级别 | enum | 国家级 / 省级 / 校级 / 院级 |
| `social_practice_hours` | 实践时长 | threshold | number（小时） |

---

## 四、Seven Screens · 逐屏规格

### 屏 A ｜ 问题屏　⏱ 0–8s

| 维度 | 内容 |
|------|------|
| **屏幕布局** | 满屏留白，正中一句话；下方一份 PDF 缓慢浮现。无导航栏、无侧边栏、无 Dashboard |
| **组件** | `QuestionHeadline` · `FloatingFileCard` |
| **真实数据** | `关于开展2026年度国家奖学金评审工作的通知.pdf`（真文件名，不是「示例文件.pdf」） |
| **AI 输出** | 无 |
| **动效** | PDF 淡入 + 上浮 8px，1s 内完成 |
| **用户操作** | 无 |
| **后端实现** | 无 |
| **可 Mock** | ✅ 全部静态 |
| **评委看懂什么** | 问题不是「文件太多」，是「文件进来之后不知道它对自己意味着什么」 |

### 屏 B ｜ 输入屏　⏱ 8–20s

| 维度 | 内容 |
|------|------|
| **屏幕布局** | 中央拖拽区；文件吸附后原地转为解析态 |
| **组件** | `DropZone` · `IngestProgress` |
| **真实数据** | 同一份 PDF，真实上传 |
| **AI 输出** | 无（此处**不要**出现任何「AI 正在思考」的伪动画） |
| **动效** | 文件吸附 → 进度条 → 自动进入 C 屏 |
| **用户操作** | 拖入文件 |
| **后端实现** | `POST /api/ingest` → 落盘 + 计算 `docId`；异步开始解析 |
| **可 Mock** | ❌ 必须真实读取（但解析结果可等 C 屏再做） |
| **评委看懂什么** | 用户不整理，系统负责理解 |

### 屏 C ｜ 事务屏（规则解析）　⏱ 20–42s

| 维度 | 内容 |
|------|------|
| **屏幕布局** | 左 55%：PDF 原文视窗（pdf.js 文本层）　右 45%：条件卡列表 |
| **组件** | `PdfViewer` · `ConditionCard[]` · `HighlightLayer` · `ConfidenceBadge` |
| **真实数据** | `Transaction` + `Condition[]`（每条含 `source_span.quote`） |
| **AI 输出** | 事务名称 / 截止时间 / 提交对象 / 条件项 / 材料清单 |
| **动效** | 条件卡逐条刷出（stagger 80ms）；点击卡片 → 左侧滚动定位 + 黄底高亮 1.2s 后渐隐 |
| **用户操作** | 点击任一条件 → 左侧原文定位 |
| **后端实现** | ① PDF → 文本（含分页）② 分块 → LLM（JSON Mode）抽 `Transaction` ③ **每条字段回带 `quote`** ④ 校验：`deadline` 必须可解析为日期，抽不到就 `null`，**绝不许编** ⑤ 低置信度字段打黄标 |
| **可 Mock** | 🟡 置信度阈值可调；**但抽取本身必须真实** |
| **评委看懂什么** | **结构化条件 ← 原文证据**。证据链从这一屏就开始，这是全场信任的起点 |

> **72h 实现提示（重要）**：不要试图算 `bbox`。让 LLM 返回**精确 quote 字符串**，前端在 pdf.js 文本层做**字符串匹配定位**——实现量减少 80%，视觉效果几乎一样。定位失败时降级为「按页高亮 + 侧栏显示 quote」。

### 屏 D ｜ 匹配屏（条件匹配）　⏱ 62–82s

| 维度 | 内容 |
|------|------|
| **屏幕布局** | 左右对照两列，中间连线区。左列「通知要求」，右列「我的信息」 |
| **组件** | `RequirementColumn` · `FactColumn` · `MatchConnector` · `StatusPill` |
| **真实数据** | `Condition[]` × `UserFact[]`（预置 JSON） |
| **AI 输出** | `MatchResult[]`——每条含 `status` / `reason` / `evidence_id` |
| **动效** | 连线逐条绘制（命中实线、未命中虚线）；每连一条右侧浮出 `StatusPill` |
| **用户操作** | 悬停连线 → 浮出 `reason` |
| **后端实现** | ① **词表对齐**：`Condition.key` ↔ `UserFact.key` ② **规则引擎**（纯代码）：threshold 比大小 / boolean 取真值 / enum 判包含 / existence 判有无 ③ LLM **只负责把自然语言条件归一化到 key+op+value**，不参与判定 ④ 输出 `MatchResult` |
| **可 Mock** | 🟡 `UserFact` 预置（= 用户已上传过材料，合理）；**匹配判定必须真算** |
| **评委看懂什么** | **Requirement ↔ Evidence 的逐条映射能力**（本项目最核心的技术证明屏） |

> ❌ 禁止出现的文案：「AI 觉得你适合」「智能推荐」「画像高度匹配」。
> ✅ 要出现的是三段式：**条件 → 用户事实 → 匹配结果**。

### 屏 E ｜ 缺口屏（Gap + 证据链）　⏱ 82–125s

| 维度 | 内容 |
|------|------|
| **屏幕布局** | 上下两段：「你已经具备什么」/「还缺什么」；右侧为可展开的证据抽屉 |
| **组件** | `GapPanel` · `ReadinessBar` · `MaterialChecklist` · `EvidenceDrawer` |
| **真实数据** | `Gap`（由 `MatchResult[]` 聚合） |
| **AI 输出** | 无（**本屏零 LLM**，纯聚合 + 读证据） |
| **动效** | 上段 ✓ 项依次打勾 → 下段 ⚠ 项依次出现 → 底部 `readiness` 条走满 |
| **用户操作** | 点击任一 ✓ → 右侧滑出 `EvidenceDrawer` |
| **后端实现** | ① `Gap` = 对 `MatchResult` 按 status 分组（纯聚合）② `GET /api/evidence/{id}` 返回 `Evidence`（源文件 + 位置 + 片段）③ `readiness = satisfied / total` ④ 缺源告警：`MaterialItem` 既无 `template_ref` 又无 `evidence_ref` → 标 `warning` |
| **可 Mock** | 🟢 本屏**全部可真实实现**，且必须真实 |
| **评委看懂什么** | 「与你有关」不够，**「你距离完成还差什么」才是价值**；且**每一个判定都可追溯** |

> 底部汇总**只能写「当前还有 3 项材料需要准备」**。
> ❌ 绝不写「预计准备时间 3 小时」——时间估不准，一旦报错，用户对**所有**判定的信任会一起塌。

### 屏 F ｜ 执行屏（Agent + 材料工作区）　⏱ 125–162s

| 维度 | 内容 |
|------|------|
| **屏幕布局** | 上半：执行日志流　下半：材料工作区清单 |
| **组件** | `ActionLogStream` · `MaterialPackList` · `SuggestChip` |
| **真实数据** | `ActionStep[]` · `MaterialPack` |
| **AI 输出** | 步骤文案（`verb` + `object`），动词限白名单 |
| **动效** | 日志逐条推进（每条 0.6–1s）；已完成项左侧打勾并轻微右移 |
| **用户操作** | 点击某材料项 → 展开来源与建议 → `[确认使用]` |
| **后端实现** | `POST /api/prepare` → 遍历 `Gap.missing_materials` + 已有 `Evidence`，生成 `ActionStep[]` 与 `MaterialPack`；`evidence_ref` 必须真实存在 |
| **可 Mock** | 🟡 日志节奏可脚本驱动，但**每条必须对应真实发生的动作** |
| **评委看懂什么** | 从「判断」进入「行动」的那一步 |

> ❌ 不许让 Agent 开场说「你好，我是你的 AI Agent」——立刻变成普通聊天机器人。
> ❌ 动词白名单外的词一律不许出现。

### 屏 G ｜ 确认与回环屏　⏱ 162–180s

| 维度 | 内容 |
|------|------|
| **屏幕布局** | 材料包汇总卡 → 回到屏 A 的同一份 PDF，但内容已变 |
| **组件** | `PackSummary` · `ConfirmExportButton` · `TransformedFileCard` |
| **真实数据** | `MaterialPack` 统计 + 全链路结果汇总 |
| **AI 输出** | 无 |
| **动效** | 汇总数字上滚 → 画面淡出切回初始文件卡 → 卡片内容逐行替换 |
| **用户操作** | 点击 `[确认并导出]` |
| **后端实现** | `POST /api/confirm` → 记录确认，**不触发任何外部提交** |
| **可 Mock** | ❌ 必须真实交互（这一屏的诚实度决定可信度） |
| **评委看懂什么** | **刻意展示「不自动提交」**——涉及资格判断与个人材料，Human-in-the-loop 让系统更可信 |

---

## 五、后端接口清单

| 方法 | 路径 | 入参 | 出参 | 屏 |
|------|------|------|------|----|
| POST | `/api/ingest` | file | `{ docId }` | B |
| POST | `/api/extract` | `{ docId }` | `Transaction` | C |
| GET | `/api/context` | — | `UserFact[]` | D |
| POST | `/api/match` | `{ transactionId }` | `MatchResult[]` | D |
| GET | `/api/gap` | `{ transactionId }` | `Gap` | E |
| GET | `/api/evidence/{id}` | — | `Evidence` | E |
| POST | `/api/prepare` | `{ transactionId }` | `{ steps: ActionStep[], pack: MaterialPack }` | F |
| POST | `/api/confirm` | `{ packId, accepted: string[] }` | `{ ok: true }` | G |

**只有 `/api/extract` 依赖 LLM。** 其余四个接口是确定性代码——这就是为什么这个 Demo 在 72h 内做得完，而且现场跑两次结果一样。

---

## 六、Demo 数据设计（**开工前必须定死**）

### 6.1 源通知选型标准

必须是**真实的**校内制度性文件，且正文含明确的「条件条款」。若通知只写「请符合条件的同学申报」，**抽不出条件，C 屏就是空的**。

### 6.2 缺口必须提前设计

Demo 要立体，条件结果**必须同时覆盖四种状态**：

| 状态 | 设计示例 | 演示价值 |
|------|---------|---------|
| `SATISFIED` ×3 | 学生类别、年级、获奖经历 | 撑起「已具备」上段 |
| `CONFLICT` ×1 | 要求实践 ≥30 小时，用户实践证明显示 **12 小时** | **最有说服力**——有材料但不达标 |
| `UNKNOWN` ×1 | 要求「无挂科」，但用户未上传成绩明细 | 触发「需人工确认」，展示诚实边界 |
| `MISSING` ×1 | 要求成绩排名前 10，用户无排名证明 | 撑起「还缺什么」下段 |

> ⚠️ **`CONFLICT` 是全场最值钱的一条**——它证明系统真的在**判断**，而不是在**匹配关键词**。只做「有 / 没有」的 Demo，评委会觉得就是关键词匹配。

> 个人数据请从 [[个人档案]] 取用后**脱敏**，示例值不要写进本文件。按库内约定，个人事实只维护在 `01-关于我/个人档案.md`。

### 6.3 素材清单

| # | 素材 | 备注 |
|---|------|------|
| 1 | 真实奖学金/评优通知 PDF | 含明确条件条款 |
| 2 | 成绩单（含排名） | 脱敏 |
| 3 | 获奖证书 1–2 张 | 脱敏 |
| 4 | 实践证明（时长刻意低于要求） | 制造 `CONFLICT` |
| 5 | 学校申请表模板 | 可选 |

---

## 七、实现顺序（72h）

| 顺序 | 任务 | 依赖 | 卡点提醒 |
|------|------|------|---------|
| 1 | 定死 Demo 数据（通知 + 4 份材料 + 缺口设计） | — | **先做这个**。数据没定，后面全白做 |
| 2 | `/api/extract` 打通真实 PDF 抽取 | 1 | 先跑通再谈 UI |
| 3 | 受控词表 + `UserFact` JSON | 1 | 词表必须和 C 屏抽出的 key 对齐 |
| 4 | 规则引擎 + `MatchResult` | 3 | 纯代码，半天内可完成 |
| 5 | `Gap` 聚合 + `Evidence` 接口 | 4 | 半天 |
| 6 | 屏 C / D / E 三屏 UI | 2·4·5 | **这三屏是核心，先做** |
| 7 | 屏 B / F / G | 6 | 相对机械 |
| 8 | 屏 A + 动效打磨 | 6 | 留到最后 |
| 9 | 180s 掐表彩排 | 全部 | **至少彩排 3 次** |

> 排期逻辑：**先把「论证链」做出来（2→3→4→5），再做界面。** 反过来做，最后会得到一个漂亮但证明不了任何东西的壳。

---

## 八、Mock 政策速查

| 层 | 政策 |
|----|------|
| 🟢 **必须真实** | PDF 条件抽取 · 原文定位 · 条件匹配判定 · Gap 计算 · 证据链来源 · 人工确认交互 |
| 🟡 **允许预置** | `UserFact` 个人上下文 · 学校模板 · 条款库 · 执行日志节奏 · 低置信度阈值 |
| 🔴 **禁止伪造** | 判定结果写死 · 证据指向不存在的文件 · 材料包内容无中生有 · 文案出现「生成/编写」个人经历 |

> **一条判据**：预置只允许发生在「输入侧」，不允许发生在「输出侧」。

---

返回 [[可行动事务Agent-Demo状态表]] · [[可行动事务Agent-产品定义]] · [[00-首页|🏠 首页]]
