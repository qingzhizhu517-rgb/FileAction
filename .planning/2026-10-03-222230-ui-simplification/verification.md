# 界面精简验证

实际记录时间：2026-10-03T22:51:18+08:00（北京时间）。

## 范围

保留左侧文件导航、中间对话、右侧本文件沉淀的原有列宽与响应式断点。修改仅限 src/web/index.html、app.js、style.css 及相关浏览器测试，未修改模型、存储或记忆后端。原始文件和路径清单已在本目录 originals/、paths.json 保存。

去掉装饰标语及重复说明；只有一个文件时收起重复文件标签栏，多文件时显示。速览改为紧凑条目，日期区间、倒计时、入口和出处保留。首轮突出“与你有关”；阅读视角、概要和依据默认折叠。历史回复操作按钮收起，最新回复仍可补充、跳过、结束或生成产物。右侧个人沉淀的修改按钮与标题同列，来源、参考档案、原文、保存状态可展开，导出入口可直接操作。

## TDD

新增 tests/ui_simplify_browser.cjs，改动前单文件重复标签、阅读视角未折叠和旧回复操作区未收起等预期失败；另外验证打开出处后右侧原文保持折叠的断言在移除自动展开前失败。实现后新增四项验收均通过。

## 实际验证

- node --check src/web/app.js：通过。
- node --test tests/quicklook.test.cjs：6 项通过。
- .venv/bin/python -m unittest discover -s tests -v：83 项通过。
- tests/ui_simplify_browser.cjs：4 项通过；桌面三栏、多文件、多会话、编辑、导出、原文、可选问题与发送范围展开均可操作。
- tests/workspace_browser.cjs：全部通过；流式文字、自动沉淀、编辑优先、恢复、COS 替身、取消和迟到回复、失败提示、移除确认、未接入无假输出均检查。
- tests/feedback_browser.cjs：5 项通过；原文弹窗、阅读视角纠正、空回答取消与问题补充。
- tests/personal_memory_browser.cjs：4 项通过；本人信息筛选、重点展示、编辑自动归档与手机布局。
- tests/quicklook_browser.cjs：6 项通过；日期和材料去重、链接分类、缺少年份不计时、报名与缴费区间。
- tests/summary_browser.cjs：4 项通过；独立日期、链接、倒计时、材料与窄屏布局。
- tests/json_retry_browser.cjs：5 项通过；格式或引用失败最多自动纠正一次、不保存错误结果、接口失败不重试、取消时迟到结果不生效。
- git diff --check：通过。

浏览器脚本使用独立 8790/8791 服务、合成文件、HTTP 模型替身和 COS 替身；不表示真实模型或真实 COS 的本轮集成验收。运行时使用 bundled Node 和 NODE_PATH，Chrome headless。脚本顺序运行，避免共享合成数据互相影响。

1440、1024、768、390、320px 布局无水平溢出；已查看 ui-home.png、ui-workspace.png、ui-conversation.png、ui-mobile.png。JSON 验收报告与合成截图保存在本目录。

## 在线状态

只读检查 8787、8788 均返回 HTTP 200，均提供新 HTML、JS、CSS。检查时工作区数量分别为 2、11。没有重启旧服务或新版服务，没有清理用户临时文件；仅停止独立合成测试服务。刷新 8788 即可使用新界面。

未进行 Git 提交、推送或部署。
