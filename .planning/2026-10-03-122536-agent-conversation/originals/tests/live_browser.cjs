/* 手动真实模型验收。会使用已配置服务产生模型请求，只发送明确合成样例。 */
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1050 }, acceptDownloads: true });
  page.setDefaultTimeout(115000);
  const report = { date: new Date().toISOString(), synthetic_data: true, real_model: true, model: '', steps: [] };
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const run = async (name, fn) => {
    const start = Date.now(); await fn();
    report.steps.push({ name, passed: true, seconds: (Date.now() - start) / 1000 });
    console.log('PASS ' + name);
  };
  try {
    await page.goto('http://127.0.0.1:8787/');
    const status = await page.evaluate(async () => {
      const token = document.querySelector('meta[name="fileaction-token"]').content;
      const headers = { 'X-FileAction-Token': token };
      const [status, memory] = await Promise.all([fetch('/api/status', { headers }).then((r) => r.json()), fetch('/api/memory', { headers }).then((r) => r.json())]);
      return { configured: status.configured, persistent: status.persistent, model: status.model, memoryCount: memory.entries.length };
    });
    assert.equal(status.memoryCount, 0, '为避免发送真实个人记忆，本脚本只允许空记忆环境');
    assert.equal(status.configured, true); assert.equal(status.persistent, true);
    report.model = status.model;
    await run('后台配置加载与真实连接', async () => {
      await page.locator('#settings-open').click();
      await page.locator('#test-connection').click();
      await page.waitForFunction(() => !document.querySelector('#test-connection').disabled);
      const message = await page.locator('#config-result').textContent();
      assert.match(message, /模型已返回有效 JSON/, message);
      await page.locator('[data-close="settings-dialog"]').click();
    });
    await run('合成通知上传与真实个性化解读', async () => {
      await page.locator('#sample').click();
      await page.locator('#workspace').waitFor({ state: 'visible' });
      await page.waitForFunction(() => !document.querySelector('#analyze').disabled);
      await page.locator('#background').fill('合成体验背景：我是一名全日制在校本科生，刚完成一个软件项目；成绩和本学年资助情况尚未核实。');
      await page.locator('#send-consent').check();
      await page.locator('#analyze').click();
      await page.waitForFunction(() => !document.querySelector('#analyze').disabled);
      if (!await page.locator('#analysis-section').isVisible()) throw new Error(await page.locator('#notice').textContent());
      report.overview = await page.locator('#overview').textContent();
      report.insights = await page.locator('.insight').count();
      assert.ok(report.insights > 0);
      await page.locator('.evidence').first().click();
      assert.ok(await page.locator('.source-line.highlight').count());
      assert.equal(await page.locator('#memory-count').textContent(), '0');
    });
    await run('用户确认后真实生成可编辑材料清单', async () => {
      await page.locator('#goal').fill('请生成申请材料清单，按需要准备的文件与需要核实的条件分类，不编造成绩或资格结论。');
      await page.locator('#action-confirm').check();
      await page.locator('#generate').click();
      await page.waitForFunction(() => !document.querySelector('#generate').disabled);
      if (!await page.locator('#draft-section').isVisible()) throw new Error(await page.locator('#notice').textContent());
      report.draft_title = await page.locator('#draft-title').textContent();
      report.draft_characters = (await page.locator('#draft').inputValue()).length;
      assert.ok(report.draft_characters > 50);
    });
    await run('编辑、导出与原文定位', async () => {
      const draft = await page.locator('#draft').inputValue();
      await page.locator('#draft').fill(draft + '\n\n用户验收补充：先核对资助情况，再决定是否提交。');
      const wait = page.waitForEvent('download'); await page.locator('#export-draft').click();
      const download = await wait; await download.saveAs('var/live-model-synthetic-draft.md');
      assert.match(await fs.readFile('var/live-model-synthetic-draft.md', 'utf8'), /用户验收补充/);
      await page.screenshot({ path: 'var/live-model-preview.png', fullPage: true });
      assert.deepEqual(errors, []);
      await page.locator('#finish').click();
    });
    await fs.writeFile('var/live-model-verification.json', JSON.stringify(report, null, 2));
    console.log(JSON.stringify({ model: report.model, passed: report.steps.length, insights: report.insights, draft_characters: report.draft_characters }));
  } finally { await browser.close(); }
})().catch((e) => { console.error(e.message); process.exitCode = 1; });
