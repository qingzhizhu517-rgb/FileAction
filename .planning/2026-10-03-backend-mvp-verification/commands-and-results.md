# 后端 MVP 验证记录

- 实际日期：2026-10-03
- 分支：dreambackend
- 说明：以下为实际运行输出摘要；未配置真实模型时烟测按预期失败，不构成真实 LLM 验收。

## 命令与结果

### `node --test tests/*.test.js`

- 退出码：0
- tests：36
- pass：36
- fail：0

### `git diff --check`

- 退出码：0
- 输出：无输出

### `env -u LLM_BASE_URL -u LLM_API_KEY -u LLM_MODEL node scripts/llm-smoke.mjs`

- 退出码：1
- 输出：not_configured: LLM_BASE_URL, LLM_API_KEY, and LLM_MODEL are required

### `npm start`

- 启动后 `GET http://127.0.0.1:8788/api/status` 返回：
  `{"status":"ok","supportedFormats":["text/plain","text/markdown"],"maxBytes":1048576,"modelConfigured":false,"bindHost":"127.0.0.1"}`
- 状态检查完成后已停止本地进程；未修改仓库跟踪目录。

## 未验证范围

- 未提供真实 `LLM_BASE_URL`、`LLM_API_KEY`、`LLM_MODEL`，因此没有执行真实模型调用、真实引用核验或模型效果验收。
- 未接入浏览器产品页面，因此没有宣称浏览器上传、确认、导出流程已验收。

## 最终回归（修复后）

- `node --test tests/*.test.js`：退出码 0；tests 38，pass 38，fail 0。
- `git diff --check`：退出码 0；输出 无输出。
- 未配置模型烟测：退出码 1；输出 not_configured: LLM_BASE_URL, LLM_API_KEY, and LLM_MODEL are required。
- 密钥值扫描（排除文档与 `.planning/`）：退出码 1；输出 无匹配。

## 修复记录

- 模型超时现在覆盖响应体读取阶段，新增回归测试。
- `/api/status` 现在披露安全的模型端点、模型名和外发数据范围，同时清除 URL 查询、用户信息与密钥。
- 独立子代理审查工具在当前会话不可用；已完成本地静态审查、语法检查、全量测试和密钥值扫描。
