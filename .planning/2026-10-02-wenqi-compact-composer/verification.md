# 文启对话布局调整验证记录

日期：2026-10-02

## 最终变更

- 桌面端保留左侧关联材料栏，宽度为 228px。
- 对话正文与输入区使用统一对齐线，最大阅读宽度为 920px；压缩顶部工具栏高度。
- 输入框默认单行，发送按钮与输入内容同行，减少快捷按钮及说明文字的上下留白。
- 支持 `field-sizing: content` 的浏览器中，输入框随内容增高，最高 124px；其他浏览器使用固定高度并允许内部滚动。
- 移动端保留对话与材料切换，消息区域独立滚动，触屏发送按钮保留 44px 尺寸。

## 已执行检查

```powershell
git pull --ff-only origin codex/fileaction-file-info-cards-20261002
node --test --test-reporter=spec .planning/2026-10-02-wenqi-file-info-cards/file-info-cards.test.cjs .planning/2026-10-01-wenqi-layout-balance/demo-interactions.test.cjs 05-交互Demo/tests/engine.test.mjs
git diff --check
```

远程拉取结果为 Already up to date。测试共 46 项，全部通过，0 项失败。差异空白检查通过。

## 验证限制

浏览器自动审批因保存的用户权限设置拒绝访问 `http://127.0.0.1:8767`。没有通过其他浏览器、脚本或协议绕过限制，因此尚未完成真实浏览器视觉验收。上述自动化测试覆盖 DOM 交互和规则逻辑，不代表像素布局或输入框自动增高已在真实浏览器验证。

## 修改前快照

各阶段原文与路径清单分别保存在同级任务目录：

- `../2026-10-02-wenqi-conversation-layout/`
- `../2026-10-02-wenqi-restore-material-sidebar/`
- 当前目录。
