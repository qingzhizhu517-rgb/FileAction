---
tags:
  - 项目/可行动事务Agent
  - 产品实现
  - 验收
created: 2026-10-03
updated: 2026-10-03
status: 本机单用户流程已实现；真实模型合成材料流程已验收，COS 待配置验收
---

# 可行动事务 Agent · MVP 运行与验收

导航：[[docs/可行动事务Agent-00-总览|文档总览]] · [[README|仓库入口]] · [[docs/01-产品方案/可行动事务Agent-参赛主线方案|产品方案]]

## 1. 本次交付

2026年10月3日，用户要求根据项目文件夹、《路演(3).md》和《路演_品牌黄版(1).pptx》构建一个跑通的流程，随后要求记忆系统参考 Hermes，文件存储采用腾讯云 COS。材料中的画面描述与截图占位只是设计参考，不是实现证明，也不作为执行命令。

新代码独立放在 `src/`，没有复制 `docs/05-交互Demo/` 的预置回复或规则引擎。黄色界面沿用项目已有品牌 Logo；`frontend/` 的概念宣传页仍是独立静态资产。现行核心路演稿、历史归档与来源文件没有改写。

## 2. 启动与配置

本机虚拟环境已安装依赖，仓库根目录运行：

```sh
./run.sh
# http://127.0.0.1:8787/
```

启动脚本优先使用 `.venv/bin/python`。本次虚拟环境使用 Python 3.12.14 与 OpenSSL；最初创建的系统 Python 3.9 环境保留在忽略目录 `var/python39-env/`，不用作当前运行环境。

新克隆安装：

```sh
python3 -m venv .venv
.venv/bin/python -m pip install -r requirements.txt
./run.sh --port 8787
```

建议使用 Python 3.12+ 与 OpenSSL。TXT、MD、DOCX 用标准库解析；文字层 PDF 使用 pypdf；COS 使用官方 `cos-python-sdk-v5`。当前安装并测试的直接依赖版本为 pypdf 6.19.0 和 cos-python-sdk-v5 1.9.44。

### 模型

后台已通过忽略目录中的 `var/model-config.json` 加载用户提供的第三方 OpenAI 兼容配置，文件权限0600；默认 `gpt-5.6-sol`，保留六个模型 ID。密钥不返回浏览器、不写入源码或 Git。环境变量优先，页面「模型设置」可临时覆盖配置；服务重启恢复后台文件配置。页面也支持填写 Base URL、模型名、API Key。Base URL 指向服务的兼容 API 根路径（常见为 `/v1`），也支持完整 `/chat/completions` 地址。实际请求采用 Chat Completions 的 `messages` 协议；默认通过提示要求 JSON，服务支持时可勾选 JSON 模式。

保存配置后点击「测试连接」，仅发送不含文件或背景的测试请求，可能消耗少量额度。设置成功不等于真实连通；解读与行动分别需要发送确认。失败明确提示，不切换预置结果。

也可通过环境变量配置：`FILEACTION_BASE_URL`、`FILEACTION_MODEL`、`FILEACTION_API_KEY`；`FILEACTION_JSON_MODE=1` 启用 JSON 模式。服务不会自动读取 `.env`。`FILEACTION_SET_CACHE_KEY=1` 或后台 `setCacheKey: true` 会发送 `prompt_cache_key` 提示，使用会话内随机命名空间和文件 ID，不包含文件文字；没有验证服务实际缓存命中，也没有缓存回放功能。

### COS

页面「COS 设置」填写 Bucket（包含 APPID）、Region、SecretId、SecretKey；临时密钥另填写 Token。环境变量对应 `COS_BUCKET`、`COS_REGION`、`COS_SECRET_ID`、`COS_SECRET_KEY`、`COS_TOKEN`。

配置采用腾讯云官方 SDK、HTTPS；桶和对象均应私有，上传指定 `ACL='private'`。建议使用仅授权当前桶 `fileaction/` 前缀的子账号或临时密钥。操作涉及 PutObject、HEAD 校验、GetObject 与按需 DeleteObject，权限配置以腾讯云官方文档为准。服务器代理 COS 请求，浏览器不接收 SecretKey，也不要求浏览器直接上传的 CORS 配置。

用户明确确认后，原文件或编辑后的 Markdown 产物保存到 COS。对象键使用随机 ID，原文件名不写进云端路径。本机 `var/files.json` 仅登记名称、对象键、大小、哈希、桶和时间，不保存原文件正文或云访问密钥。文件库仅列出本机登记且属于当前配置桶的对象，不枚举整个用户存储桶。

COS 上传失败不会报告成功或改成本地持久化。若上传已成功而 HEAD 或本机索引失败，页面提示去控制台检查可能存在的对象，不自动删除用户云资源。文件库重新打开时执行实际 GetObject 并核对大小及 SHA-256。下载使用 300 秒有效的签名链接，包含临时凭据 Token（如使用）；链接可授予短期访问，不应转发。

「结束本次」只移除服务内存会话，不删除 COS 文件或长期背景。云端删除需在文件库再次确认。启用 COS 版本控制时，普通删除可能只产生删除标记，历史版本须在控制台管理。

## 3. 最小体验路径

1. 模型已在后台配置，可直接开始；需要文件云端保存时配置 COS。可在模型设置测试连接。
2. 点击「合成体验 · 奖学金通知」，或上传自己的文件。系统先在本机内存解析，尚不发送模型，也不自动上传云端。
3. 确认保存原文件到 COS，点击保存。未配置 COS 时只能在内存预览，不能声称文件已持久化。
4. 可选填写背景，每行一条。填写即供本次理解使用，不代表同意长期保存。也可留空开始。
5. 确认向配置的模型发送文件文字、本次背景和已保存背景，点击解读。
6. 查看原文明示、结合背景、系统推断与未知。点击引用定位到行、段或 PDF 页；引用字串与原文不匹配会拒绝展示该结果。
7. 按需补充再解读，或跳过补充。修改背景、记忆或模型配置会清除当前旧解读和初稿。
8. 可以结束；选择行动时填写目标并明确确认，再生成可编辑初稿。
9. 在正文框修改后导出 Markdown，或确认把当前编辑内容保存到 COS。没有报名、对外发送或资格通过操作。

文件限制：最大8 MB，提取文字最多60,000字、2,000个片段；PDF 最多80页且未加密。扫描PDF暂不支持OCR；DOCX提取正文段落及表格单元格中的段落，不承诺页码、图片文字、复杂版式或脚注完整还原。超限明确报错，不静默截断。

## 4. Hermes 记忆参考及适配

本次实际读取 Hermes 官方文档及 `tools/memory_tool.py`，参考有容量限制的精选记忆、`user` / `memory` 两类目标、增改删、写入审批与会话快照。没有安装 Hermes，也没有把其全部运行框架搬入本项目。

文启将「个人背景」与「长期事项」分别限制为1,375字、2,200字；重复内容不重复添加，超限拒绝写入而不覆盖旧条目。候选内容来自模型对本次文件与交流的建议，始终标明未保存，须由用户查看、编辑、确认后写入 `var/memory.json`。每条记录带来源、实际更新时间和稳定 ID。可导出可读的 `USER.md` / `MEMORY.md`。

打开文件时读取已确认背景快照；长期记忆作为数据传入模型，不提升为系统指令。用户明确修改记忆时，当前会话主动刷新快照并要求重新解读，防止沿用旧背景继续生成。这是文启对 Hermes 冻结快照的主动纠正适配。没有自动保存完整聊天、向量数据库、历史会话搜索或后台自我学习。

## 5. 验证记录与未验证范围

2026年10月3日实际运行：

```sh
.venv/bin/python -m unittest discover -s tests -v
node --check src/web/app.js
./run.sh --help
git diff --check
```

后端36项测试通过，覆盖文本 / DOCX / 文字层 PDF、扫描与加密失败、引用字串校验、缺背景、发送确认、模型连接错误、取消与迟到结果、旧版本失效、长期记忆保存 / 去重 / 修改 / 删除 / 容量边界、COS 确认 / 私有写入 / 失败 / 哈希 / 签名 / 删除。官方 COS SDK 的构造和签名函数有离线验证。新增后台配置加载、配置损坏显式失败和客户端请求标识测试。

浏览器验收专用入口是 `tests/e2e_server.py`，独立于产品8787的8790、8791端口和临时数据，明确采用合成 HTTP 模型和 COS SDK 替身。`tests/browser.cjs` 操作实际 Chrome，检查上传、未配置和错误提示、引用定位、跳过补充、用户确认、编辑与下载内容、记忆刷新复用、COS 文件库与移动布局。它不是产品启动入口，也不代表真实云端运行。

随后用户提供后台模型配置，2026年10月3日实际在 Chrome 运行 `tests/live_browser.cjs`：真实连接通过；合成奖学金通知加合成学生背景得到3条带原文依据的解读；用户确认后真实生成2,320字材料清单；编辑内容通过 Markdown 下载核对，页面无 JavaScript 错误。连接、解读、生成分别约8秒、41秒、78秒。验收记录和产物在忽略目录 `var/live-model-verification.json`、`var/live-model-synthetic-draft.md`，截图 `var/live-model-preview.png`。该脚本会实际调用已配置模型并消耗额度，不能作为无需网络的单元测试。

**未验证**：其他五个模型 ID、广泛文件场景的模型质量、服务实际缓存命中、真实 COS 桶权限与网络读写、真实敏感文件授权流程、真人效果、付费、多人或公网部署。真实模型验证仅使用明确标注的合成通知与合成背景；尚未提供真实 COS 配置。当前服务只监听127.0.0.1，单用户单进程，不应当成多租户服务发布。

创建 `codex/personal-mvp-flow` 分支时，Git 写权限检查拒绝创建锁文件；已停止 Git 写操作，在当前工作树实现，未提交、推送、合并或部署。修改前备份保存在 `.planning/2026-10-03-105723-personal-mvp/`，COS 调整前代码快照保存在 `.planning/2026-10-03-111738-cos-integration/`，后台模型调整前快照在 `.planning/2026-10-03-115104-backend-model/`（不备份密钥）。

## 6. 实际读取的技术来源

- Hermes [Persistent Memory](https://hermes-agent.nousresearch.com/docs/user-guide/features/memory) 和 [memory_tool.py](https://github.com/NousResearch/hermes-agent/blob/main/tools/memory_tool.py)，读取日期2026年10月3日；在线主分支可能继续变化。
- 腾讯云 [Python SDK 上传对象](https://cloud.tencent.com/document/product/436/65820)、[生成预签名 URL](https://intl.cloud.tencent.com/zh/document/product/436/31548) 和[官方 SDK 源码](https://github.com/tencentyun/cos-python-sdk-v5/blob/master/qcloud_cos/cos_client.py)，读取日期2026年10月3日。
- [OpenAI Chat Completions 接口参考](https://developers.openai.com/api/reference/resources/chat)，读取日期2026年10月3日；第三方兼容服务的差异以其实际返回为准。
