---
tags:
  - 项目/可行动事务Agent
  - 竞品分析
created: 2026-09-30
updated: 2026-10-02
status: 桌面调研；未注册试用、未做同题实测
---

# 可行动事务 Agent · 竞品分析

导航：[[docs/可行动事务Agent-00-总览|文档总览]] · [[docs/01-产品方案/可行动事务Agent-参赛主线方案|参赛主线方案]]

> **读取日期与可靠性**：本篇的主体调研读取于2026年9月30日，大部分内容来自检索摘要，没有逐页打开原文；OpenAI 发布说明抓取失败（403）。所列能力都是厂商公开说明，不是我们实测的结果。凡标“2026-09-26”的条目，沿用旧调研的记录（原文见 `.planning/2026-09-26-market-research/` 与 [[docs/90-历史归档/旧方案-2026-09-30/02-调研与可行性/可行动事务Agent-市场调研与验证|旧市场调研]]）。

> **2026-10-02 口径调整**：依据用户指定的[[docs/03-参赛与路演/可行动事务Agent-核心路演稿|核心路演稿]]调整分析重点，本次未重新联网读取外部来源。第3、4节的外部能力与规则记录保留原读取日期和可靠性说明，不视作当前能力已核验。第6节仅保留未来团队方向的研究线索。

## 1. 结论

- 本轮待验证的是“文件入口 → 结合已确认背景的个性化解读 → 用户选择后的可编辑产物”。原文依据、未知标注、按需询问和用户决定是否保留沉淀，是这条体验的组成部分。
- 不再以“可信复用是最强差异”“用错材料被退回是主痛点”替代核心项目重点。材料适用性是申报等场景中的能力，不能成为所有文件的统一流程。
- 既有资料包含多种工具的记忆、引用、任务和生成能力，不能据此宣称通用 AI 只能摘要、不了解用户或都做不到。是否有可验证优势，仍需同题实测。
- 学生奖学金是可选体验场景，教师和业务负责人也可用个人端理解文件；不把历史学生市场切口当成永久人群边界。团队与企业均留在未来探索。

## 2. 按现行主线设计比较

| 关注维度 | 本项目待验证目标 | 公平比较方法 |
|---|---|---|
| 个性化解读 | 解释哪些内容与当下用户有关及其理由 | 同一文件、相同已确认背景与目标，比较重点、漏项和误关联 |
| 依据与不确定性 | 区分文件原文、个人背景、推断和未知 | 核对关键判断能否定位依据，信息不足是否明确 |
| 按需询问 | 只补会影响判断的信息，允许跳过 | 计入补充、回读、纠正成本，不要求对照工具只做摘要 |
| 用户可控沉淀 | 可查看、修改并选择是否保留 | 分别检查本次使用与长期保存，观察下一份文件的实际复用 |
| 可选行动 | 用户选择后生成可编辑产物，沿用已确认信息 | 记录实际编辑或使用，而非只计生成次数；理解后结束也可成功 |

这些是验证标准，不是已取得的领先结论。参照工具选择、模型版本、日期和完整提示在实际测试时记录。

## 3. 产品能力明细

### 国际

| 产品 | 相关能力 | 来源 |
|---|---|---|
| ChatGPT | 据检索摘要和媒体报道，Pulse 于2026-06-17宣布停用，由定时任务承接。定时任务可提醒、监控、按事件触发；在项目中创建的任务读不到项目文件（此条限制在2026-09-26的读取中也有记录） | [定时任务帮助](https://help.openai.com/en/articles/10291617)、[Pulse 发布](https://openai.com/index/introducing-chatgpt-pulse) |
| Claude | 跨会话记忆，可查看、编辑、导入导出；每个 Project 有独立的记忆空间 | [记忆帮助](https://support.claude.com/en/articles/11817273) |
| Gemini | Personal Intelligence 需主动连接 Gmail、Drive 等；Daily Brief 提炼优先事项；仅限18岁以上个人账号，学校账号不可用 | [帮助页](https://support.google.com/gemini/answer/16598469) |
| NotebookLM | 回答附引用，点击可跳到原文位置；帮助页现称 Gemini Notebook | [帮助页](https://support.google.com/notebooklm/answer/16179559) |
| Mem 2.0 | Heads Up 在写作或开会时主动浮现相关笔记 | [官方博客](https://get.mem.ai/blog/introducing-mem-2-0) |
| Saner.ai | 每天读取邮件、待办和笔记生成计划；从邮件中提取任务 | [官网](https://www.saner.ai/)（营销页） |
| remio | 本地采集网页、会议和文件；回答标注来源；有学生页 | [学生页](https://www.remio.ai/student)（营销页） |
| Notion | Custom Agents 可由定时、邮件、数据库变更等触发，在后台运行；按 Credits 计费 | [帮助页](https://www.notion.com/help/custom-agents) |
| M365 Copilot | Planner Agent 可把目标、截止时间或文档拆成任务；Project Manager agent 负责分派和汇报 | Microsoft Tech Community 官方博客 |
| Glean | Personal Graph 记录个人任务与协作者；Agent 支持定时或事件触发 | [官方博客](https://www.glean.com/blog/live-fall-25-main) |

### 国内

| 产品 | 相关能力 | 来源 |
|---|---|---|
| 腾讯 ima | 个人与共享知识库；一键存入微信文章和聊天文件；基于知识库问答（2026-09-26已记录与 WorkBuddy 连接后“资料 → 任务 → 产物回存”） | [官网](https://ima.qq.com)、[腾讯云文档](https://cloud.tencent.com/document/product/1831/134397) |
| 豆包 | 记忆只从对话文本中提取，不包括上传的图片、文件和链接；条数有上限 | [记忆说明](https://www.doubao.com/legal/memory_faq) |
| 腾讯元宝 | 作为微信联系人解析文件、总结转发的聊天记录；记忆功能缺少官方说明 | 应用商店页、媒体报道 |
| 夸克 | AI 学习资料、网盘与文件工具；没有查到记忆或任务能力 | [官网](https://www.quark.cn) |
| 飞书 | 消息和文档可转为任务；aily（部分帮助页已改名“豆包工作伙伴”）能关注群聊、定时汇报；智能体可操作多维表格为员工分配任务 | [飞书帮助中心](https://www.feishu.cn/hc/zh-CN/articles/790732948604)、[aily 帮助](https://aily.feishu.cn/hc) |
| 钉钉 | AI 表格支持任务流转、分配和汇总；工单助理从消息中识别问题并派单 | [AI 表格](https://table.dingtalk.com)（营销页） |
| WPS 灵犀 | 个人 Office 智能体：写作、读文档、生成 PPT | [官方文章](https://www.wps.cn/article/wps-ai-wps-ling-xi-2026-IVpVEEyC.html) |
| 接龙管家 | AI 创建：说出需求或上传文档图片即可生成收集表；导入名单后标记已交/未交、一键催交、汇总导出 | [官网](https://www.jielong.com) |

### 校园综测与材料类

没有检索到商业 AI 产品或小程序（微信小程序生态无法通过网页搜索覆盖）。GitHub 上有开源项目：[zongceskill](https://github.com/AvaliableEndless/zongceskill) 用 AI 整理综测材料，并输出“还能加分的证书”清单；[BLCU-extra-points-filing](https://github.com/hammerwu0609-rgb/BLCU-extra-points-filing) 内置“只取最高级别”等规则。它们说明“规则判断材料”这个方向不是全新的。

## 4. 旧调研中仍有参考价值的证据（2026-09-26读取）

- **禁重复申报是真实规则**：[北京理工大学国际组织创新学院2025研究生国奖通知](https://sgg.bit.edu.cn/tzgg/6ee2028c055e48df83ef64d4c1f663b8.htm)规定，已用于获国奖的同一成果及支撑材料不得重复申报。“本次不能用”的演示可以以此为原型，但不能推广成所有奖项的统一规则。
- **旧项目会被动员参加新比赛**：[沈阳航空航天大学2026创新大赛院级初赛通知](https://cxxy.sau.edu.cn/info/1018/2704.htm)动员近三年的获奖项目参赛，需要项目计划书、佐证材料和 PPT。这支持“主动发现旧 Idea”的场景。
- **社团有周期性材料链**：[北京师范大学珠海校区社团活动申报通知](https://youth.bnuzh.edu.cn/tzgg/66ace4f5cc4841ba9f8b21d91f9c04b6.htm)要求月度申请、审批表、汇总表和活动后总结。这支持团队版的社团场景。
- **普通表格可能已经够用**：一篇 [r/scholarships 讨论](https://www.reddit.com/r/scholarships/comments/1p5fi86/how_do_you_guys_organize_all_your_scholarship/)中，提问者认可了“总表加状态跟踪”的建议。这是需要正面回应的反证。
- **旧调研的判断**：复用成立在“检索加重新核实”上，不是“一键照搬”。

## 5. 对方案的影响

1. 路演重点回到个性化解读：收到文件，先交给文启，讲清它对当下用户的意义。材料复用作为适用场景下的支持能力。
2. 对照工具获得相同文件、背景和目标；评估关联理由、可核对性、未知处理、交互成本和可选产物，不先写优胜结论。
3. 团队与企业是未来探索，不用相关工具的功能差异为本届团队功能作承诺。
4. 不用旧需求分级将阅读、筛选和重复解释背景贬为“仅开场铺垫”；它们是原稿要求优先验证的问题。
5. 外部能力变化与现行可用性须在对外引用或实测前重新核验；本次仅做内部文档对齐，原来源日期不变。

## 6. 未来团队方向的历史研究（2026-09-30读取）

当时围绕“临时组队，按能力推荐分工”候选方向另做了一轮检索；现行核心路演已将团队协作放在未来，本节不表示本届交付范围。只逐页打开了 Devpost 和 Microsoft People Skills 两页原文，其余来自检索摘要，引用前还需再核对。

| 产品 | 相关能力 | 来源 |
|---|---|---|
| Devpost | 参赛者勾选“looking for teammates”，手写自我介绍和想找的队友，发 Team-up 邮件；没有技能筛选或 AI 匹配（已打开原文） | [帮助页](https://help.devpost.com/article/75-participants-page-forming-a-team) |
| HackerEarth、MLH、Kaggle、天池 | 队友开关、组队频道、邀请合并队伍或论坛“找队友”帖，都靠人工自荐 | [HackerEarth](https://help.hackerearth.com/forming-teams)、[MLH 指南](https://guide.mlh.io/general-information/event-logistics/hackathon-communication-platform) |
| 智队搭（开源小程序） | 技能画像、AI 评级、智能匹配池，面向 iCAN 赛；个人项目，运营状态未知 | [GitHub](https://github.com/LanTu-Qin/smart-team-build) |
| Microsoft People Skills | 从 M365 数据推断技能画像，用户可确认编辑；Copilot 能“找具备所需技能的人”；可做组织级技能缺口报告；仅限商业租户，不含教育版（已打开原文） | [Microsoft Learn](https://learn.microsoft.com/en-us/microsoft-365/copilot/people-skills-overview) |
| Glean | Expert Search 根据实际贡献推断专家 | [文档](https://docs.glean.com/tools/glean/expert-search) |
| Asana AI Studio | 可以按成员的 Expertise 字段加提示词用 AI 分配负责人；营销称结合容量与技能 | [AI Studio](https://asana.com/product/ai/ai-studio)（营销页加社区教程） |
| ClickUp Brain | AI Assign：为每个候选人写一段技能描述，由 AI 自动分配 | [帮助页](https://help.clickup.com/hc/en-us/articles/38333921529623-Automatically-assign-tasks-using-AI) |
| Notion Agent | 官方用例：分析团队项目，为成员生成计划并分配任务 | [用例页](https://www.notion.com/product/ai/use-cases/task-management-for-teams) |
| monday、Motion、Jira Rovo | 营销称按技能或容量分配；Rovo 能把 epic 拆成子任务，没找到它同时推荐负责人的说法 | 营销页、官方社区 |
| ChatGPT 共享项目 | 强制使用项目内记忆，不能访问成员的个人记忆 | [Projects 帮助](https://help.openai.com/en/articles/10169521-projects-in-chatgpt) |

**对未来探索的意义（推断，未经同题实测）**：

- 这些线索可供以后验证技能展示、组队和分工需求，不能据有限检索断言“找人的平台都不分工”或“分工工具都不了解人”。
- 若探索从个人沉淀生成能力名片，仍需成员显式授权，并单独验证可回溯性、推荐理由和真实协作价值。
- 共享空间与个人信息的权限边界值得研究，但不能由历史产品描述推出本项目已实现授权机制或形成竞争优势。
- 按技能分配不是新发明；本轮以个人文件理解为先，不将此节当作路演主证据。

## 7. 未能核实

- OpenAI 发布说明原文；ChatGPT Memory 与 Projects 的现行帮助页；Pulse 停用的官方原文。
- 元宝记忆、夸克的记忆与任务能力；钉钉 DING 的 AI 派发；飞书 aily 改名的范围。
- 微信小程序中是否已有综测或奖学金类 AI 工具。
- 各产品对中国大陆学生的实际可用性和价格（Notion Credits 除外）。
- 团队版相关：Asana 帮助页正文、monday 与 Motion 按技能分配的实际上线范围；钉钉、Linear、DataFountain、和鲸、挑战杯与互联网+平台的组队功能；飞书是否有按技能推荐分工。

返回 [[docs/可行动事务Agent-00-总览]] · [[docs/01-产品方案/可行动事务Agent-参赛主线方案|参赛主线方案]]
