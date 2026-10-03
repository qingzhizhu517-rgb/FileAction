/* 浏览器完整流程验收：仅连接 tests.e2e_server 的合成模型替身。 */
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { chromium } = require('playwright');

(async () => {
  const output = process.env.FILEACTION_TEST_OUTPUT || '/tmp/fileaction-browser-test';
  await fs.mkdir(output, { recursive: true });
  const browser = await chromium.launch({ headless: true, channel: 'chrome' });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1080 }, acceptDownloads: true });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  const waitNotice = (part) => page.waitForFunction((text) => document.querySelector('#notice').textContent.includes(text), part);
  const analyze = async () => {
    await page.locator('#send-consent').check();
    await page.locator('#analyze').click();
    await page.locator('#analysis-section').waitFor({ state: 'visible' });
    await page.locator('#analyze').waitFor({ state: 'visible' });
    await page.waitForFunction(() => !document.querySelector('#analyze').disabled);
  };
  try {
    // 未配置的隔离实例，不读取生产配置或调用真实模型。
    await page.goto('http://127.0.0.1:8791/');
    await page.getByText('○ 模型未配置', { exact: true }).waitFor();
    await page.screenshot({ path: path.join(output, 'welcome.png'), fullPage: true });
    await page.locator('#sample').click();
    await page.locator('#workspace').waitFor({ state: 'visible' });
    await page.locator('#analyze').click();
    await page.locator('#settings-dialog').waitFor({ state: 'visible' });
    assert.equal(await page.locator('#analysis-section').isVisible(), false);
    await page.locator('[data-close="settings-dialog"]').click();
    await page.locator('#finish').click();
    console.log('PASS 未配置模型时明确提示，不生成假结果（隔离实例）');

    await page.goto('http://127.0.0.1:8790/');
    await page.getByText(/合成HTTP测试替身（非真实LLM） · 已配置/).waitFor();
    await page.locator('#settings-open').click();
    await page.locator('#test-connection').click();
    await page.getByText('模型已返回有效 JSON。可以开始解读。', { exact: true }).waitFor();
    await page.locator('[data-close="settings-dialog"]').click();
    console.log('PASS HTTP 模型连接测试（明确合成替身）');

    await page.locator('#upload').setInputFiles({ name: '合成浏览器通知.txt', mimeType: 'text/plain', buffer: Buffer.from('合成通知\n全日制本科生可以申请。\n申请须提交项目成果说明和成绩单。\n截止2026年10月20日。') });
    await page.locator('#workspace').waitFor({ state: 'visible' });
    await page.waitForFunction(() => !document.querySelector('#analyze').disabled);
    await page.locator('#store-original').click();
    await waitNotice('请先确认将这份原文件保存到腾讯云 COS');
    await page.locator('#cos-consent').check();
    await page.locator('#store-original').click();
    await waitNotice('原文件已上传到 COS');
    await page.waitForFunction(() => !document.querySelector('#analyze').disabled);
    assert.match(await page.locator('#cos-file-state').textContent(), /已保存到 COS/);
    console.log('PASS COS 独立确认、上传和校验（明确 SDK 替身）');
    await page.locator('#analyze').click();
    await waitNotice('请先确认文件与背景的发送范围');
    await analyze(); // 背景为空也能开始。
    assert.match(await page.locator('#insights').textContent(), /本次没有与此条相关的已确认背景/);
    await page.locator('.evidence').first().click();
    assert.match(await page.locator('.source-line.highlight').textContent(), /申请须提交项目成果说明/);
    await page.locator('#skip-questions').click();
    await waitNotice('你选择暂不补充');
    assert.equal(await page.locator('#memory-count').textContent(), '0');
    console.log('PASS 文件上传、无背景解读、引用定位、跳过补充、不自动保存');

    await page.locator('#background').fill('合成用户完成过一个软件项目');
    assert.equal(await page.locator('#analysis-section').isVisible(), false);
    await analyze();
    await page.locator('#generate').click();
    await waitNotice('请先确认继续生成初稿');
    await page.locator('#action-confirm').check();
    await page.locator('#generate').click();
    await page.locator('#draft-section').waitFor({ state: 'visible' });
    await page.waitForFunction(() => !document.querySelector('#export-draft').disabled);
    await page.locator('#draft').fill('# 用户修改的合成清单\n\n- [ ] 用户新增：核对成绩单');
    const downloadPromise = page.waitForEvent('download');
    await page.locator('#export-draft').click();
    const download = await downloadPromise;
    const filename = path.join(output, download.suggestedFilename());
    await download.saveAs(filename);
    assert.match(await fs.readFile(filename, 'utf8'), /用户新增：核对成绩单/);
    const analysisDownload = page.waitForEvent('download');
    await page.locator('#export-analysis').click();
    await (await analysisDownload).saveAs(path.join(output, 'analysis.md'));
    assert.match(await fs.readFile(path.join(output, 'analysis.md'), 'utf8'), /依据 L3/);
    await page.screenshot({ path: path.join(output, 'flow.png'), fullPage: true });
    page.once('dialog', (d) => d.accept());
    await page.locator('#store-draft').click();
    await waitNotice('当前编辑后的产物已保存到 COS');
    await page.waitForFunction(() => !document.querySelector('#files-open').disabled);
    await page.locator('#files-open').click();
    await page.locator('#files-dialog').waitFor({ state: 'visible' });
    assert.equal(await page.locator('#files-list .memory-entry').count(), 2);
    await page.locator('[data-close="files-dialog"]').click();
    console.log('PASS 个性化背景、旧结果失效、用户确认、编辑与下载文件内容');

    await page.locator('#candidates .quiet').click();
    await page.locator('#memory-content').fill('合成用户是本科生，完成过软件项目');
    assert.equal(await page.locator('#memory-consent').isChecked(), false);
    await page.locator('#memory-consent').check();
    await page.locator('#memory-form button[type="submit"]').click();
    await page.locator('#edit-memory-dialog').waitFor({ state: 'hidden' });
    await waitNotice('长期背景已更新');
    assert.equal(await page.locator('#memory-count').textContent(), '1');
    assert.equal(await page.locator('#analysis-section').isVisible(), false);
    await page.locator('#finish').click();
    await page.reload();
    await page.locator('#files-open').click();
    await page.locator('#files-dialog').waitFor({ state: 'visible' });
    await page.locator('#files-list .memory-entry').filter({ hasText: '合成浏览器通知.txt' }).getByRole('button', { name: '打开', exact: true }).click();
    await waitNotice('已从 COS 读取文件');
    assert.match(await page.locator('#sources').textContent(), /申请须提交项目成果说明/);
    await page.locator('#finish').click();
    await page.locator('#files-open').click();
    await page.locator('#files-dialog').waitFor({ state: 'visible' });
    for (let i = 0; i < 2; i++) {
      page.once('dialog', (d) => d.accept());
      await page.locator('#files-list button').filter({ hasText: '删除云端文件' }).first().click();
      await page.waitForFunction((expected) => document.querySelectorAll('#files-list .memory-entry').length === expected, 1 - i);
    }
    await page.locator('[data-close="files-dialog"]').click();
    console.log('PASS COS 文件库、重新打开并验证哈希、用户确认删除（SDK 替身）');
    await page.locator('#memory-open').click();
    await page.getByText('合成用户是本科生，完成过软件项目', { exact: true }).waitFor();
    await page.locator('.memory-entry button').filter({ hasText: '修改' }).click();
    await page.locator('#memory-content').fill('合成用户是研究生');
    await page.locator('#memory-consent').check();
    await page.locator('#memory-form button[type="submit"]').click();
    await page.locator('#edit-memory-dialog').waitFor({ state: 'hidden' });
    await page.getByText('合成用户是研究生', { exact: true }).waitFor();
    page.once('dialog', (d) => d.accept());
    await page.locator('.memory-entry button').filter({ hasText: '删除' }).click();
    await page.waitForFunction(() => document.querySelector('#memory-count').textContent === '0');
    await page.locator('[data-close="memory-dialog"]').click();
    console.log('PASS 记忆审阅、明确保存、刷新复用、修改和确认删除');

    await page.locator('#sample').click();
    await page.locator('#workspace').waitFor({ state: 'visible' });
    await page.waitForFunction(() => !document.querySelector('#analyze').disabled);
    await page.locator('#background').fill('无效引用合成测试');
    await page.locator('#send-consent').check();
    await page.locator('#analyze').click();
    await waitNotice('原文引用校验失败');
    assert.equal(await page.locator('#analysis-section').isVisible(), false);
    await page.waitForFunction(() => !document.querySelector('#analyze').disabled);
    await page.locator('#background').fill('延迟合成测试');
    await page.locator('#send-consent').check();
    await page.locator('#analyze').click();
    await page.locator('#cancel').click();
    await waitNotice('本次请求已取消');
    await page.waitForTimeout(3400); // 验证真实迟到响应不会生效，非性能等待。
    assert.equal(await page.locator('#analysis-section').isVisible(), false);
    console.log('PASS 无效引用报错、取消与迟到结果失效');

    await page.locator('#finish').click();
    await page.locator('#upload').setInputFiles({ name: '合成.exe', mimeType: 'application/octet-stream', buffer: Buffer.from('synthetic') });
    await waitNotice('暂时支持 TXT');
    assert.equal(await page.locator('#workspace').isVisible(), false);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.screenshot({ path: path.join(output, 'mobile.png'), fullPage: true });
    const dimensions = await page.evaluate(() => ({ full: document.documentElement.scrollWidth, viewport: innerWidth }));
    assert.ok(dimensions.full <= dimensions.viewport, '移动端无横向溢出');
    assert.deepEqual(errors, [], '页面无脚本异常');
    console.log('PASS 不支持格式报错、移动布局、无页面脚本错误');
    console.log(`浏览器验收完成，输出 ${output}。真实 LLM 未验证。`);
  } finally { await browser.close(); }
})().catch((e) => { console.error(e); process.exitCode = 1; });
