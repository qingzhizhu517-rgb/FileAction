---
tags:
  - 项目/可行动事务Agent
  - 竞品分析
created: 2026-09-30
updated: 2026-10-01
status: 桌面调研；未注册试用、未做同题实测
---

# 可行动事务 Agent · 竞品分析

导航：[[可行动事务Agent-00-总览|文档总览]] · [[01-产品方案/可行动事务Agent-参赛主线方案|参赛主线方案]]

> **读取日期与可靠性**：本篇的主体调研读取于2026年9月30日，大部分内容来自检索摘要，没有逐页打开原文；OpenAI 发布说明抓取失败（403）。所列能力都是厂商公开说明，不是我们实测的结果。凡标“2026-09-26”的条目，沿用旧调研的记录（原文见 `.planning/2026-09-26-market-research/` 与 [[90-历史归档/旧方案-2026-09-30/02-调研与可行性/可行动事务Agent-市场调研与验证|旧市场调研]]）。

## 1. 结论

- **四个环节单独看都有人做。** 主动推送有 Gemini、ChatGPT、Mem；原文引用有 NotebookLM；从文档生成任务有 M365 Planner Agent；分派和催交有飞书、钉钉、接龙管家。
- **可以主张的是串起来的那条链**（以下是推断）：以一份通知为触发点，对照个人经历、获奖和意向，判断每份材料“本次能不能用”，再推进到待办、起草和收件。检索中没有发现哪家产品完整做到这一点。
- **最强的差异在可信复用。** 引用原文很常见，但判断“这份材料对这次通知是否适用”（过期、需更新、往届成果不得重复申报）的产品很少。这应当是路演里的杀手锏。
- **分派加催交的团队工具竞争最激烈，企业版则和大厂正面重叠。** 9月30日团队版已改为“临时组队，按能力推荐分工”，避开接龙管家、飞书、钉钉的强项；组队与技能推荐类竞品见第6节。企业版只作为路线图。
- **国内学生场景有切入口**（推断）：豆包的记忆不从上传的文件中提取；Gemini 的个人上下文功能不支持学校账号。

## 2. 按亮点对照

| 亮点            | 最接近的竞品                                                                                                      | 它们做到什么                                          | 我们可主张的差异（推断）                                                          |
| ------------- | ----------------------------------------------------------------------------------------------------------- | ----------------------------------------------- | --------------------------------------------------------------------- |
| 主动发现          | Gemini Daily Brief、ChatGPT 定时任务、Mem Heads Up、remio                                                          | 以邮箱、日历或阅读行为为触发，推送“今天该做什么”或相关笔记                  | 以单份通知为触发，对照个人经历、获奖和意向，给出“与你有关，已有✓，还缺□”                                |
| 可信复用          | NotebookLM、remio、飞书妙记；开源 zongceskill、BLCU-extra-points-filing                                               | 回答附原文引用；开源综测工具用写死的规则判断加分                        | 从通知原文提取适用规则，判断材料是否过期、需更新或本次不能用                                        |
| 直接行动          | M365 Planner Agent、ChatGPT、WPS 灵犀、豆包                                                                        | 从文档拆任务和截止；提醒；起草文档                               | 通知 → 缺项 → 起草 → 日历连成一条，起草只用用户确认过的资料                                    |
| 团队按人推荐分工      | 组队：Devpost、HackerEarth；分工：Asana AI Studio、ClickUp AI Assign、Notion Agent；技能画像：Microsoft People Skills、Glean | 组队靠手写自我介绍；按技能分配需要预先写好字段或提示词，建在长期工作区上；画像依附企业租户数据 | 能力名片从个人记忆授权生成、可回溯；面向临时组队；从竞赛通知拆工作块并对照指出能力缺口；推荐附理由，成员可以拒绝；不监督进度（详见第6节） |
| （不再走的路）分派催交汇总 | 接龙管家、飞书 aily 加多维表格、钉钉 AI 表格与工单助理                                                                            | 上传文档或图片生成收集表；标记已交/未交、一键催交、汇总导出                  | 团队版已放弃这条路线                                                            |

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

1. 路演把“可信复用”作为差异的主证据，“主动发现”作为开场亮点；不宣称“只有我们有记忆或主动推送”。
2. 团队版不做分派、催交和汇总，承认接龙管家、飞书在这方面已经覆盖得很好；差异写成“先了解人，再推荐事”。
3. 企业版只放路线图，不和飞书、钉钉、Copilot、Glean 做功能比较。
4. 按10月1日赛前直播的需求分级，“读文件、有记忆”属于大厂已充分竞争的“需要”层级，不作卖点。主打“用错材料被退回”这一有明确后果的痛点，差异依据是本篇的可信复用对照（见 [[01-产品方案/可行动事务Agent-参赛主线方案|参赛主线方案]] 第11节）。
5. 赛后要做同题实测：同一份通知，分别用豆包或 ChatGPT 加记忆、接龙管家和本产品完成，计入找文件、确认和纠错的全部时间。

## 6. 团队版：组队与按专长分工（2026-09-30读取）

团队版改为“临时组队，按能力推荐分工”以后，另做了一轮检索。只逐页打开了 Devpost 和 Microsoft People Skills 两页原文，其余来自检索摘要，引用前还需再核对。

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

**判断（推断）**：

- 能找人的平台不分工，能分工的工具不了解人（技能要预先手写），了解人的产品依附企业长期数据。我们没有检索到把这三者接起来、面向临时组队的产品。
- 可主张的差异：能力名片从个人记忆授权生成，每条可回溯；面向组几天、赛后解散的临时队伍；从竞赛通知拆出原型、BP、PPT 等工作块，并对照指出能力缺口；每条推荐附理由，成员可以拒绝；不监督进度，这和 Asana、monday、ClickUp 把负载与进度当卖点形成明确边界。
- ChatGPT 共享项目在设计上隔离个人记忆，说明个人记忆进入团队需要显式授权层，这正是能力名片的位置。
- 反证提醒：“按技能分配任务”本身已经是 Asana、ClickUp 的功能，不能说成新发明；智队搭说明学生组队匹配已有人尝试。

## 7. 未能核实

- OpenAI 发布说明原文；ChatGPT Memory 与 Projects 的现行帮助页；Pulse 停用的官方原文。
- 元宝记忆、夸克的记忆与任务能力；钉钉 DING 的 AI 派发；飞书 aily 改名的范围。
- 微信小程序中是否已有综测或奖学金类 AI 工具。
- 各产品对中国大陆学生的实际可用性和价格（Notion Credits 除外）。
- 团队版相关：Asana 帮助页正文、monday 与 Motion 按技能分配的实际上线范围；钉钉、Linear、DataFountain、和鲸、挑战杯与互联网+平台的组队功能；飞书是否有按技能推荐分工。

返回 [[可行动事务Agent-00-总览]] · [[01-产品方案/可行动事务Agent-参赛主线方案|参赛主线方案]]
