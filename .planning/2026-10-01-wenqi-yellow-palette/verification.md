# 文启 Demo 提交前验证记录

验证日期：2026-10-02（Asia/Shanghai）

## 提交范围

本次提交包含连续几轮已授权的 Demo 修改：文件直接进入对话、按需打开引用并高亮、多事务成果包、搜索式事务切换、顶部导航、布局协调和用户指定的暖黄色板；附带每轮修改前副本、路径清单、实现记录与离线回归脚本。

未纳入 `.idea/`、`node_modules/` 或其他本机状态。

## 远程更新

先暂存本地 Demo 改动，运行 `git pull --rebase`，当前分支从 `860325e` 快进至 `ed07869`。随后成功恢复本地改动，无冲突。远程更新涉及产品文档及对应整理记录。

## 验证结果

```powershell
node --test .planning/2026-10-01-wenqi-layout-balance/demo-interactions.test.cjs 05-交互Demo/tests/engine.test.mjs
node .planning/2026-10-01-wenqi-yellow-palette/audit_palette.cjs
git diff --check
```

- 21 项 Demo 交互回归、20 项规则测试全部通过，共 41 项、0 失败。
- CSS 能被离线 DOM 解析；所有颜色变量均有定义，未残留旧色板。
- 暖黄换肤前后 766 条已有 CSS 规则的布局属性一致，脚本仅有行内颜色变更。
- 主按钮深色文字与亮黄背景对比度为 9.01:1，悬停深黄为 6.98:1；灰色正文与暖白、浅黄背景分别为 5.24:1、4.96:1。
- `git diff --check` 无空白错误；Git 提示工作区 LF 会按本机设置转换为 CRLF，不属于测试失败。

离线脚本依赖 jsdom 26.1.0，依赖目录不入库。新环境可先运行：

```powershell
npm install --prefix .planning/2026-10-01-wenqi-morandi-refinement/test-runtime --no-save --package-lock=false jsdom@26.1.0
```

## 验证限制

此前浏览器访问本机 Demo 被保存的阻止设置拒绝。虽然用户已授权访问，本轮未通过其他入口绕过该限制；没有完成真实浏览器操作或截图验收。上述 DOM 测试与样式审计不等同于浏览器视觉验收。

演示仍为合成示例，没有接入真实模型，也没有读取或提交个人资料。
