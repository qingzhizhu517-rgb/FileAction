# 本机 MVP 实际验证记录

记录时间：2026-10-03T11:45:19+08:00

- `.venv/bin/python -m unittest discover -s tests -v`：33项通过，无跳过。模型和COS网络行为使用明确合成替身；官方COS SDK签名离线实测。
- `node --check src/web/app.js`：通过。
- `./run.sh --help`：通过。
- `git diff --check`：通过。
- 修改文档的标题、代码围栏和现行链接检查：通过。代码围栏中的shell注释和行内示例不作为标题或文档链接。
- Playwright实际操作Google Chrome：完整流程通过，包含未配置模型、合成接口连接、上传、COS单独确认、原文引用、背景修改使旧结果失效、用户确认、编辑、下载正文内容、COS文件库重新打开和哈希校验、云端删除确认、记忆保存和刷新复用、取消迟到结果、失败提示以及390px移动布局。无页面脚本错误。

浏览器实际命令：

```sh
.venv/bin/python -m tests.e2e_server
NODE_PATH=/Users/ant/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules /Users/ant/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node tests/browser.cjs
```

浏览器第一次COS回归中，测试脚本未等待文件库异步载入就检查数量，断言失败。补上等待对话框出现后，从新的独立临时测试数据重新运行，全部通过。没有将首次失败报告为通过。

截图与下载文件位于 `/tmp/fileaction-browser-test/`，内容都是标明的合成数据，已实际查看桌面和移动截图。

当前真实运行入口：`./run.sh --port 8787`，仅监听127.0.0.1。生产页面不配置合成模型或合成COS。

真实LLM、真实COS桶读写未验证，等待用户在本地设置填写自己的配置。没有使用上传的路演材料调用外部模型，没有上传真实用户文件。

创建任务分支被Git写权限阻止，停止Git写操作；当前工作树上实现，未commit、push、merge或部署。
