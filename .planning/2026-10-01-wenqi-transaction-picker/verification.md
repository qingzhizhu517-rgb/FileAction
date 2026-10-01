# 事务选择器验证记录

实际验证日期：2026-10-01。

## 结果

- 21 / 21 项离线 DOM 交互测试通过，包括上一轮引用预览、草稿编辑、行动计数等回归。
- 20 / 20 项原规则引擎测试通过。
- `git diff --check` 通过。Git 仅提示后续可能进行 LF/CRLF 规范化。
- HTML 无重复 ID，内联 JavaScript 可解析；两个页面折叠时各只有一个事务选择按钮。
- 隔离测试中临时加入 100 个事务（连同原示例共 102 个），搜索、末尾项选择、计数与新事务默认产物正确；测试数据不写入 Demo。
- 列表内部滚动、当前事务置顶、键盘选择、Esc 取消、空结果、清空搜索、切页关闭、焦点返回与中文输入法确认均已测试。
- 窄视口测试验证浮层计算的边界与样式声明，不等同于真实浏览器渲染验收。

## 复现命令

```powershell
node --test .planning/2026-10-01-wenqi-transaction-picker/demo-interactions.test.cjs
node --test 05-交互Demo/tests/engine.test.mjs
git diff --check
```

本轮测试复用上一轮安装在 `.planning/2026-10-01-wenqi-morandi-refinement/test-runtime/node_modules/` 的 jsdom 26.1.0，不增加 Demo 的运行依赖。

## 验证边界

此前浏览器工具访问本机地址被拒绝，未获得新的许可。本轮未尝试绕过访问限制，因此没有完成真实浏览器视觉与鼠标操作验收。

原文与路径清单保存在本目录。上一轮快照及测试记录保持原样，`.idea/` 未修改。
