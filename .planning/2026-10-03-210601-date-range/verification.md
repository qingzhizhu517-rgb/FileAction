# 日期区间展示验证

实际日期：2026-10-03，Asia/Shanghai。

- 同一原文段落中由“至、到、横线、波浪线”直接连接的两个有效日期合为一个起止区间，报名与缴费分别标为“报名日期”“缴费日期”。
- 不强行合并不同事项、无连接词日期列表。重复区间去重；保留原文 source_id 和 quote。
- 截止估算使用原文终点日期；缺年份不补全、多日期段不猜测精确时区。
- 前端静态更新，不重启 8787/8788，不重新上传用户文件，不改实际用户档案。

## 真实运行结果

1. `node --test tests/quicklook.test.cjs`：新行为先确认两项失败；修复后六项通过。
2. `node tests/quicklook_browser.cjs`：六项通过，包括合成文件上传、报名/缴费各一行、两个端点原文、1440/768/390/320 屏幕无溢出。
3. `node tests/summary_browser.cjs`：四项通过。
4. `.venv/bin/python -m unittest discover -s tests -v`：83 项通过，3.734 秒。
5. `node --check src/web/app.js` 和 `git diff --check`：通过。
6. `/tmp/fileaction-date-range.png` 实际视觉检查通过。

浏览器使用 8790 隔离合成 HTTP 模型与 COS 替身，不是实际 LLM 或腾讯云集成验收；用户原文件未外发。
