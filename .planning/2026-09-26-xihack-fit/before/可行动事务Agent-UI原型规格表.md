---
tags:
  - 项目/可行动事务Agent
  - 黑客松
  - UI规格
created: 2026-09-23
updated: 2026-09-26
status: 修订规格，尚未实现或实测
---

# 可行动事务 Agent · UI 原型规格表（开发候选）

> **本文件是学分 Demo 的字段、判定、接口和验收契约主源，不代表已有实现。** 实际样本与适用政策仍待取得和审核；当前没有源码、测试框架或性能结果。
> 产品边界以 [[可行动事务Agent-定位决策]] 为准；合成样例见 [[可行动事务Agent-学分认定Demo规格]]；演示状态见 [[可行动事务Agent-Demo状态表]]。

## 一、实现范围与建议技术栈

MVP 限一校、一版有效制度、一个适用群体、一种 CSV 导出模板。读取 1–2 份文本 PDF 制度与 1 份 CSV 已认定记录；核验总量、创新创业、文艺体育三个数值条件。其余类别只作已导入汇总展示，规则覆盖为 `partial`。

| 层 | 候选方案 | 约束 |
|---|---|---|
| 界面与接口 | Next.js App Router + Tailwind + Node 运行时 | 团队熟悉其他技术栈时可替换，不为换栈消耗演示时间 |
| PDF | pdf.js 文本提取与渲染 | 仅支持有文本层的所选样本；扫描件标不支持 |
| CSV | 一种已核实导出格式的适配器 | 明确编码、表头、数值与空值处理，保留行列定位 |
| 存储 | 本地 SQLite + 私有文件目录 | 二进制不进公开静态目录；云部署需另选持久化存储 |
| 规则候选 | 支持结构化输出的 LLM + schema 校验 | JSON 合法不等于规则正确；模型版本与提示词版本记入运行记录 |
| 规则执行 | 确定性比较与聚合函数 | 不执行模型生成的代码；不引入通用 CSP 求解器 |

首版不包含 OCR、Word、多校、任意格式导入、开放式聊天、自动教务对接或企业 Demo。可先完成输入、核对、缺口三个工作面，再拆成七屏呈现。

## 二、处理链与审核边界

```text
制度 PDF → 带页码文本 → LLM 规则候选 → schema / 引用 / 范围检查 → 人工审核
教务 CSV → 模板映射 → 来源 / 数值 / 重复 / 汇总检查 → 人工确认
                                    ↓
                        固定版本输入快照 → 规则判定
                                    ↓
                          缺口 → 证据 → 假设试算 / 清单
```

LLM 可以抽错阈值、漏掉例外或选择错误制度版本。审核须检查原文语义、适用群体、单位、有效期和依赖条款；不能只确认 JSON 格式。模型自报 `confidence` 可作排查提示，不作为概率、正确率或自动放行依据。

规则先进入待审核状态。任何人工改动保留原候选、修改原因、审核时间与新版本；重新抽取不能覆盖已发布快照。同一已确认输入快照、规则版本和算法版本应给出相同结果；重新调用 LLM 并不保证输出相同。

## 三、最小数据契约

以下字段是拟实现契约。示例 ID、证据和数值均为**合成结构示例**，对应文件尚未建立，不能显示为真实来源或真实运行结果。

### 3.1 Dataset / SourceDocument / EvaluationContext

| 对象 | 必需字段与语义 |
|---|---|
| `Dataset` | `id`、`context_id`、`data_mode`（`real` / `synthetic`）、`input_mode`（`live_extract` / `reviewed_fixture` / `replay`）、`source_doc_ids`、`snapshot_id`。数据性质与输入方式分开标识 |
| `SourceDocument` | `id`、`sha256`、`name`、`format`（`pdf` / `csv`）、`role`（`policy` / `record`）、私有存储引用、导入时间。真实制度另保留发布来源、版本与获取时间 |
| `EvaluationContext` | `id`、脱敏 `subject_id`、`institution_id`、`policy_version`、`population`（年级/专业等实际适用字段）、`period_start`、`period_end`、`as_of`、审核状态；未知字段为 `null` |
| `RuleSet` | `id`、`version`、`condition_ids`、`context`、`coverage`（`partial` / `complete`）、`required_inventory_reviewed`、`aggregation_policy`、审核记录。只审核三个条件时不能设置完整覆盖 |
| `Transaction` | `id`、`title`、`type: obligation`、`rule_set_id`、`dataset_id`、`deadline_at`、`deadline_raw`、`deadline_evidence_ids`、`condition_ids` |

`deadline_at` 使用含时区的日期时间或 `null`，如 `2026-10-10T17:00:00+08:00`；不能把「17:00 前」压成日期。原文缺年份、时间或时区且无法确认时保留原文和待核实状态，不自动补为当天年底或 23:59。制度未规定单次提交期限时可以为空，不能因此编出提醒。

适用范围或计入期间未确认时，相应条件进入 `UNKNOWN`。完整规则清单尚未审完与单条规则能否执行是两件事：后者可以计算，前者必须通过覆盖标识限制总体结论。

### 3.2 Evidence —— 双方依据

每条规则、事实及换算依据都通过 `evidence_ids` 引用 Evidence。证据必须能回到实际存储的来源，不能只给一个文件名。

```json
{
  "id": "ev_synthetic_record_innovation",
  "source_doc_id": "doc_synthetic_record",
  "location": { "row": 5, "columns": ["category", "recognized_hours"] },
  "quote": "创新创业,12",
  "citation_status": "FOUND",
  "review_status": "CONFIRMED",
  "reviewed_by": "demo_reviewer",
  "reviewed_at": "2026-09-26T10:00:00+08:00"
}
```

PDF 使用 `location.page`；CSV 使用从 1 开始的原文件行号（含表头）及列名。`citation_status` 为 `FOUND` / `NOT_FOUND`；`review_status` 为 `PENDING` / `CONFIRMED` / `REJECTED`。确认表示审核人认可该来源映射，**不表示学校已批准系统的结论**。

PDF 定位流程：页内精确匹配 → 受控空白规范化匹配 → 验证唯一位置。多处命中需用户选择；未匹配时仅打开该页并显示「未定位」，不得整页染色冒充精确引用。原文 quote 保留不变，定位辅助文本单独处理。找不到来源的规则不得进入正式数值判定。

### 3.3 Condition 与 UserFact

```json
{
  "id": "cond_sc_innovation",
  "rule_set_id": "rules_synthetic_v1",
  "key": "sc_innovation",
  "label": "创新创业学时",
  "kind": "threshold",
  "operator": ">=",
  "value": 20,
  "unit": "hour",
  "scope": "category",
  "required": true,
  "review_status": "CONFIRMED",
  "evidence_ids": ["ev_synthetic_rule_innovation"]
}
```

```json
{
  "id": "fact_sc_innovation",
  "subject_id": "synthetic_student",
  "snapshot_id": "snapshot_synthetic_v1",
  "key": "sc_innovation",
  "value": 12,
  "unit": "hour",
  "aggregation_level": "category",
  "recognition_status": "recognized",
  "review_status": "CONFIRMED",
  "evidence_ids": ["ev_synthetic_record_innovation"]
}
```

- `Condition.key` 与 `UserFact.key` 共用下表词表。首版只执行 `kind: threshold`、`operator: >=`，不支持的条件保留为待处理项，不能丢掉后宣称完整覆盖。
- `unit: hour` 在本场景规范为「学时」，不是自动等同于时钟小时。非负有限数值才有效；空白为 `null`，不是 0。负值、无法解析值进入 `UNKNOWN`。
- `scope` 仅用于区分 `total` / `category` 和界面分组；它不能替代适用范围、聚合规则或去重规则。
- `recognition_status` 为 `recognized` / `pending` / `unknown`。已有有效的已认定汇总可独立判断；新增待认定证书不加到汇总中。只有待认定材料而无有效汇总时为 `UNKNOWN`。
- 汇总事实绑定相同人员、统计期间和快照。换算另存原值、原单位、公式、舍入规则和对应制度证据；首版优先选无需换算的样本，不把学校规则写死在通用词表。

| key | 标签 | 当前用途 |
|---|---|---|
| `second_class_hours_total` | 二课总学时 | 核验总量 |
| `sc_innovation` | 创新创业 | 核验分类 |
| `sc_arts_sports` | 文艺体育 | 核验分类 |
| `sc_social_practice` | 社会实践 | 导入汇总，未核验 |
| `sc_volunteer` | 志愿服务 | 导入汇总，未核验 |
| `sc_thought` | 思想成长 | 导入汇总，未核验 |
| `sc_skill` | 技能特长 | 导入汇总，未核验 |

真实学校类别不同，须建立并审核映射，不能仅按相似名称归类。总毕业学分、成绩排名、奖学金资格不属于首版词表。

其他四类的「未核验」指该类认定要求尚未审核；用于汇总核对的记录数值及来源仍需确认，不能用未经核实的数值凑平总量。

### 3.4 MatchResult 与 Gap

```json
{
  "condition_id": "cond_sc_innovation",
  "status": "CONFLICT",
  "reason_code": "THRESHOLD_SHORTFALL",
  "additional_reason_codes": [],
  "actual": 12,
  "target": 20,
  "unit": "hour",
  "deficit": 8,
  "matched_fact_ids": ["fact_sc_innovation"],
  "rule_evidence_ids": ["ev_synthetic_rule_innovation"],
  "fact_evidence_ids": ["ev_synthetic_record_innovation"],
  "adjudicated_by": "rule",
  "snapshot_id": "snapshot_synthetic_v1",
  "rule_set_version": "1",
  "algorithm_version": "1"
}
```

`reason` 展示文字由 `reason_code` 和字段生成，不交给 LLM 重判。`UNKNOWN` / `MISSING` 的 `actual`、`deficit` 为 `null`；规则阈值本身未知时 `target` 也为 `null`。界面可以展示未核实的原始值，但不得把它放入已认定数值或差值。

初始原因码：`PASS`、`THRESHOLD_SHORTFALL`、`FACT_MISSING`、`EVIDENCE_MISSING`、`RULE_UNREVIEWED`、`FACT_UNREVIEWED`、`CITATION_UNRESOLVED`、`SCOPE_UNRESOLVED`、`UNIT_UNRESOLVED`、`RECOGNITION_PENDING`、`SOURCE_CONFLICT`、`AGGREGATION_UNRESOLVED`、`INVALID_NUMBER`、`UNSUPPORTED_RULE`。前两个对应数值比较，两个 `MISSING` 码对应缺事实/来源，其余对应 `UNKNOWN`。按四态优先级选主因，其余写入 `additional_reason_codes`，不让一个主因遮蔽其他问题。

`Gap` 拟包含 `evaluation_id`、按四态分组的 `results`、`evaluated_count`、`coverage`、`total_progress`、`known_category_deficits`、`known_category_deficit_sum`、`unresolved_items`、`overall_status`。不再使用含义混杂的 `readiness` 字段。

材料需求与条件分开存为 `MaterialItem`：`id`、`name`、`linked_condition_ids`、`evidence_ids`、`status`（`FOUND` / `TO_UPLOAD` / `TO_FILL`）。材料项不进入数值条件分母；补材料也不能自动改变资格状态。

### 3.5 ActionPlan / Scenario / Export

| 对象 | 最小字段与边界 |
|---|---|
| `ActionPlan` | `id`、`evaluation_id`、`items`。每项含类别、建议动作、制度依据、待核实资格/时间/可报名性、用户确认状态。缺少活动数据时 `availability: UNVERIFIED` |
| `Scenario` | `id`、`baseline_evaluation_id`、`hypothetical: true`、`assumed_additions`、假设依据、独立结果。不修改原事实、原证据和基线快照 |
| `ActionStep` | `id`、`operation`、`status`（`pending` / `running` / `done` / `failed`）、`result_ref`。只有操作成功才可显示 done，不用固定动画伪造任务完成 |
| `Export` | `id`、`evaluation_id`、`accepted_item_ids`、实际可下载的本地 Markdown 文件引用。包含来源、范围、缺口、待确认项、数据/输入模式及导出时间 |

允许「生成清单」「计算假设」等准确动作描述；禁止编造个人经历、认定结果或来源。没有下载文件就不能把按钮写成「确认并导出」。确认仅记录用户选择，不代表学校审批或自动提交。

## 四、判定与聚合算法

### 4.1 四态优先级

每条条件按下列顺序执行，保留具体原因及受影响字段：

1. **`UNKNOWN`**：规则未审核/无法执行、引用未定位、适用范围未确认、单位不明、有效证据互相冲突、只有待认定材料、无法解释的汇总异常等。不能以模型自报置信度替代这些检查。
2. **`MISSING`**：规则及适用范围已确认，但没有所需事实或没有可核验的事实来源。可列出要补的记录，不能推断为未参加或 0 学时。
3. **`SATISFIED` / `CONFLICT`**：规则、事实及来源均已确认且口径一致，再比较 `actual >= target`。低于阈值，包括有效的 0，均为 `CONFLICT`。

`CONFLICT` 在本契约表示「已知未达标」，不是「证据互相冲突」；后者是 `UNKNOWN`。存在事实但未审核，属于 `UNKNOWN`，与完全缺证据的 `MISSING` 区分。

### 4.2 数值与汇总

- 有效数值使用明确小数精度计算；不凭空四舍五入。`deficit = max(0, target - actual)`，只对可比较的已确认值计算。
- 总量已知时 `total_progress = min(1, actual / target)`，同时展示原值 `128 / 120`；目标为 0 且非负有效值时为 1。任一值未知则为 `null`。总量进度不代表全部条件满足。
- 首版以已认定汇总为事实，不自动把多份导出的值相加。相同文件哈希重复上传不重复计入；同一快照同一类别多行不能任取最大值或累加，须由模板约定识别并审核。
- 总量与分类是同一记录集的两个视角，不能相加。分类互斥、穷尽且同口径时核对分类和与总量；差异未解释时受影响的判定为 `UNKNOWN`。尚未覆盖全部类别时标「未完成汇总核对」。
- 活动明细与汇总并存时选择一种计算粒度。跨类计入、活动上限、认定有效期和舍入规则必须有制度依据；首版遇到未支持的规则时拒绝作确定结论。
- 只有已确认同单位、互斥分类且不可跨类抵扣时，才计算 `known_category_deficit_sum`；否则为 `null` 并逐类展示。总量缺口不再加到这个数上。

### 4.3 总体结论

| 条件 | `overall_status` | 展示 |
|---|---|---|
| 至少一个 `CONFLICT` | `KNOWN_UNMET` | 已核验要求存在缺口；同时列出未核验、缺失和不确定项 |
| 无 `CONFLICT`，但有 `MISSING` / `UNKNOWN`，或覆盖不完整 | `INCOMPLETE` | 当前无法完成整体判定 |
| 所有必需条件已完整识别、审核且满足 | `SATISFIED_WITHIN_SCOPE` | 在所列规则与数据范围内已满足，仍以学校认定为准 |

首版固定为部分规则覆盖，不会产生「整体认定通过」。合成基线只核验三个条件：一项满足、两项未达标；其他四类不打勾。

### 4.4 what-if 的不变条件

合成基线为总量 128、创新 12、文体 0；阈值依次为 120、20、10。假设新增创新 10 学时且被认定，并确认可同时计入总量，则试算为**总量 138、创新 22、文体 0，文体仍差 10**。

新增事件使用独立假设 ID；重复加入相同事件不能重复计入。只在副本上应用已确认的计入规则，不写回 `UserFact`。假设成立条件（资格、期限、上限、不可重复认定）未核实时显式显示；已知与制度冲突的新增项拒绝计入。若无法确定单位或计入公式，则对应结果为 `UNKNOWN`，不展示伪精确差值。

## 五、拟定接口与失败路径

接口只是实现候选，尚不可调用。所有操作绑定同一 `dataset_id` / `snapshot_id`，读取和导出需校验所属会话或用户。

| 方法 | 路径 | 请求 / 结果 |
|---|---|---|
| POST | `/api/ingest` | 1–2 个 PDF、1 个 CSV、文件角色 → `dataset_id`、去重结果或明确的格式错误 |
| POST | `/api/extract` | `dataset_id` → `job_id`；PDF 提出规则候选，CSV 适配器产生事实候选 |
| GET | `/api/jobs/{id}` | `pending` / `running` / `needs_review` / `succeeded` / `failed`；返回真实阶段、错误码、可重试性，待审核时返回规则/事实候选 |
| POST | `/api/review` | 规则/事实候选 ID、修订值、依据及确认 → 固定 `snapshot_id`、`rule_set_version`；不原地覆盖旧版 |
| POST | `/api/evaluate` | 快照与规则版本 → `evaluation_id`、`MatchResult[]`、`Gap` |
| GET | `/api/evidence/{id}` | 受权访问的原文片段、来源位置和审核记录 |
| POST | `/api/what-if` | 基线结果、假设新增项 → 独立 `Scenario` 和试算结果 |
| POST | `/api/plan` | `evaluation_id` → 有来源的 `ActionPlan` 和待核实事项 |
| POST | `/api/export` | 用户确认的条目 ID → 实际 Markdown 下载文件 |

LLM 只参与 `/api/extract` 内的规则候选步骤；计划匹配与结果计算使用已确认规则。上传后不悄悄同时启动另一套抽取流程。重复请求使用幂等键或相同任务引用，禁止重复生成事实、行动或费用未知的无限重试。

候选文件上限为单文件 20 MB、每组最多 3 份，须在样本验证后调整；检查内容格式而非只看扩展名。扫描件、损坏文件、未知 CSV 表头、缺来源和模型服务失败均显示明确错误，不以合成数据自动替换。多用户部署、保存期限、删除和第三方模型数据处理策略完成前，只做有授权、脱敏的本地验证。

## 六、七屏实现映射

时间轴是路演预算，不是 API 延迟承诺；两处文档统一为 C 屏 **20–62 秒**。操作使用按钮或键盘均可完成，状态除颜色外同时显示文字和符号；减少动态效果设置下取消逐条动画。

| 屏 / 时间 | 布局与组件 | 数据、操作与实现重点 |
|---|---|---|
| A / 0–8s | 简洁开场，`QuestionHeadline`、数据模式标记 | 「总量够了，分类也够了吗？」合成样例必须标识；开场数字为注明来源的演示预览，不能冒充本次实时结果 |
| B / 8–20s | 文件区、`DropZone`、真实任务状态 | 输入所选 PDF 和 CSV；标明文件角色、处理模式与错误。既支持拖拽也支持文件选择 |
| C / 20–62s | 左原文右候选，`PdfViewer`、`CsvPreview`、`ReviewPanel` | 按总量/分类列规则，点击查看页码或行列；显示当前版本和适用对象。审核候选或明确标示此前人工核验的输入 |
| D / 62–82s | `RequirementColumn`、`FactColumn`、`StatusPill` | 规则、已认定事实、比较结果三列对应；未知值不填 0；仅三个核验条件参与结果 |
| E / 82–125s | `GapPanel`、`TotalProgress`、`EvidenceDrawer` | 总量 128/120 与两个分类缺口同屏；打开规则及个人记录双方证据；其他分类显示未核验，覆盖信息常驻 |
| F / 125–162s | `ScenarioPanel`、`ActionPlanList` | 先试算创新 +10，显示文体仍差 10，再列制度途径、待确认资格和期限。基线与假设结果区分；日志按真实事件推进 |
| G / 162–180s | `ExportSummary`、`ConfirmExportButton` | 用户确认后产生可下载清单；包含范围、来源、未知项及假设标签，导出失败可重试；不提交外部系统 |

来源抽屉对四态均可打开：缺失显示需要什么记录，不显示不存在的文件；不确定显示具体原因。低置信度角标、连线、逐条刷出等仅在核心逻辑验证后添加。

## 七、真实性与降级

| 数据 / 输入方式 | 允许展示 | 必须披露 |
|---|---|---|
| 真实数据 + 现场抽取 | 实际运行的抽取、审核、计算和证据 | 来源权限、范围与失败，不暗示任意学校通用 |
| 真实数据 + 人工核验输入 | 已审核的规则/事实继续真算 | 「人工核验输入」；不能宣称本场现场完成自动抽取 |
| 合成数据 | 合成规则、记录和边界用例驱动真实计算 | 「合成验收样例，非真实学校规则或个人成绩」；所有来源文件也需同样标识 |
| 缓存回放 | 有原输入、版本与日志的历史结果 | 「缓存回放」及原运行时间；不能称本次现场推理 |

预置输入仍需真实存在、能打开并说明取得方式。预置审核 JSON 是一种可用的降级模式，但它不证明当前抽取能力。禁止输出硬编码、虚构证据、修改真实成绩制造缺口，或在失败后悄悄切换成功画面。

## 八、72 小时条件预算

前提是 2–3 名熟悉栈的成员协作，所选 PDF / CSV 样本、授权、模型服务与规则审核人已到位。下列为墙钟预算建议，不是已验证工时；每段记录实际耗时和遗留问题。

| 时段 | 交付候选 | 继续条件 |
|---|---|---|
| 0–8h | 确定一校一版样本、适用范围、CSV 映射及人工标准答案 | 能明确三个条件和计算口径，否则改为合成逻辑原型 |
| 8–20h | 输入、引用定位、候选审核与固定快照 | 关键引用可核实，规则候选可检查，失败有记录 |
| 20–36h | 规则、去重/汇总校验、边界验收集 | 数值、四态和拒判符合预先写定的期望 |
| 36–52h | C / D / E 核心界面与双方证据 | 可以不用动画解释一次完整判定 |
| 52–64h | what-if、来源明确的清单、确认导出 | 假设不污染事实，下载物与界面结论一致 |
| 64–72h | 端到端复核、错误路径、三次掐表演练 | 留存实际结果；超时则合并界面或标识回放 |

核心链路不稳时先减动效、连线和七屏切换，不能删审核、未知状态、证据或范围提示。真实材料不可得时，不把缺数据问题改写成“工程已经可行”。

## 九、建议验收集与实测记录

以下均为**待实现、待运行**的验收建议。当前文档核查不等于测试通过；尚无覆盖率数据。

### 9.1 至少 30 条规则边界用例

每条先写输入、人工期望、规则依据，再运行实现；不从当前实现倒推期望。

| 编号 | 六条独立用例 |
|---|---|
| 01–06 数值 | 12<20；20=20；22>20；有效 0<10；19.5<20；负学时拒判 |
| 07–12 状态 | CSV 空白；缺少类别行；明确 0 不当缺失；未审核规则；仅有待认定材料；有效来源互相冲突 |
| 13–18 单位 | 学分无换算依据；有适用换算依据；换算依据不适用当前类别；单位缺失；次数不能直接作学时；按制度舍入边界 |
| 19–24 范围 | 年级不匹配；制度版本失效；活动晚于计入期限；必要日期缺失；统计快照不同；两份制度冲突未解决 |
| 25–30 聚合 | 重复文件；重复明细；汇总与明细不双计；跨类计入规则；无法解释的总量差；部分覆盖不能整体通过 |

对首版未支持的换算、明细或复杂规则，用例期望可以是明确 `UNKNOWN` / 拒绝处理，不能为追求通过率临时扩大执行范围。

### 9.2 至少 10 组端到端样例

1. 合成基线：128/120、12/20、0/10，已知分类缺口 18，覆盖部分。
2. 边界相等：创新正好 20，其他值及汇总同步调整，比较结果和引用正确。
3. CSV 缺值：不得默认为 0，输出 `MISSING` 与待补记录。
4. 仅有待认定材料：输出 `UNKNOWN`，不增加已认定汇总。
5. 同一文件重复导入：结果和计数不变。
6. 分类与总量异常：拒绝受影响的确定判定并指明差异。
7. 学分/学时混用且无适用换算：不计算伪精确缺口。
8. 适用群体或有效版本错误：不使用错误政策作确定比较。
9. 引用不存在、文件损坏或解析失败：可见失败，不产生成功证据。
10. 假设创新 +10 → 总量 138、创新 22、文体仍差 10；基线保持不变，确认导出的范围和未知项一致。

上述为组合类型，至少选两组用独立、获授权的真实样本验证；拿不到时仅能宣称合成逻辑验证。真实样本与人工标准答案须由可检查的来源支持，不能修改真实记录以凑四态。

### 9.3 建议发布门槛

- 所选 30 条边界用例、10 组端到端样例的预期数值、状态、范围和拒判全部符合；任何错误先修复再复测。
- 所有参与确定判定的规则与事实均能打开对应依据，且已完成审核；例外和缺失没有被静默忽略。
- what-if 不改变原始输入、已认定事实或基线结果；重复导入和重复请求不重复计入。
- 记录每次样例的输入哈希、模式、版本、预期/实际、人工修订项、抽取耗时、总耗时及失败原因；较少样本只报告实际范围，不声称统计意义上的可靠率。
- 180 秒演练至少三次，记录是否使用缓存或预审输入；现场超时允许披露降级，不承诺 22 秒完成真实抽取与人工审核。

业务发布仍需真实用户反馈、授权与学校认定边界验证；通过有限验收集只支持该输入和规则子集。

返回 [[可行动事务Agent-Demo状态表]] · [[可行动事务Agent-学分认定Demo规格]] · [[可行动事务Agent-核查修订报告]]
