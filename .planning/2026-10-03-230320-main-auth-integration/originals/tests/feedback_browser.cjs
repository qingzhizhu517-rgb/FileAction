/* 原文与问题回应验收：独立合成 HTTP 模型、合成档案；非真实 LLM。 */
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  page.setDefaultTimeout(7000);
  const checks = [], requests = [];
  let workspace;
  page.on('request', request => {
    if (request.url().endsWith('/api/chat')) requests.push(request.postDataJSON());
  });
  const ready = () => page.waitForFunction(() => !document.body.classList.contains('busy'));
  const check = async (name, fn) => {
    try { await fn(); checks.push({ name, passed: true }); }
    catch (error) { checks.push({ name, passed: false, error: error.message.split('\n')[0] }); }
  };
  try {
    await page.goto('http://127.0.0.1:8790/');
    await page.evaluate(async()=>{
      const headers={'Content-Type':'application/json','X-FileAction-Token':document.querySelector('meta[name="fileaction-token"]').content};
      const status=await fetch('/api/status',{headers}).then(r=>r.json());
      if(!status.model.includes('合成HTTP测试替身'))throw new Error('仅允许清理本测试的隔离合成档案');
      const memory=await fetch('/api/memory',{headers}).then(r=>r.json());
      for(const entry of memory.entries)await fetch('/api/memory',{method:'POST',headers,body:JSON.stringify({action:'remove',target:entry.target,entry_id:entry.id,consent:true})});
    });
    await page.reload();
    await page.locator('#upload-consent').check();
    await page.locator('#persist-consent').uncheck();
    await page.locator('#upload').setInputFiles({name:`合成反馈验收-${Date.now()}.txt`,mimeType:'text/plain',buffer:Buffer.from(`合成反馈通知 ${Date.now()}\n申请人须提交项目成果说明、成绩单。\n申请截止：2026年11月30日17:00（北京时间）。\n报名链接：https://example.com/synthetic-feedback`)});
    await page.locator('.assistant-message').waitFor(); await ready();
    workspace = await page.evaluate(async () => {
      const headers = { 'X-FileAction-Token': document.querySelector('meta[name="fileaction-token"]').content };
      return (await fetch('/api/workspaces', { headers }).then(r => r.json())).workspaces[0].id;
    });
    await check('关键信息原文打开可见出处', async () => {
      await page.locator('.highlight-source').first().click();
      await page.locator('#source-dialog').waitFor({ state: 'visible' });
      assert.match(await page.locator('#source-preview').textContent(), /成绩单|申请/);
      const target = page.locator('#source-dialog .source-preview-line.is-target');
      assert.equal(await target.isVisible(), true);
      await page.waitForFunction(() => {
        const target = document.querySelector('#source-preview .is-target').getBoundingClientRect();
        const panel = document.querySelector('#source-preview').getBoundingClientRect();
        return target.bottom > panel.top && target.top < panel.bottom;
      });
      await page.locator('[data-close="source-dialog"]').click();
    });
    await check('阅读视角可回应，取消不发送或沉淀', async () => {
      const count = requests.length, memory = await page.locator('#memory-count').textContent();
      await page.locator('.positioning > summary').click();
      await page.locator('.positioning .clarification-trigger').click();
      await page.locator('#clarification-dialog').waitFor({ state: 'visible' });
      await page.locator('#clarification-skip').click();
      assert.equal(requests.length, count);
      assert.equal(await page.locator('#memory-count').textContent(), memory);
      assert.equal(await page.locator('.assistant-message').count(), 1);
    });
    await check('空回答不发送，填入答案后按用户情况继续', async () => {
      await page.locator('.agent-question.clarification-trigger').first().click();
      const count = requests.length;
      await page.locator('#clarification-submit').click();
      assert.equal(requests.length, count);
      assert.equal(await page.locator('#clarification-dialog').isVisible(), true);
      await page.locator('#clarification-answer').fill('我是老师，想转发给学生');
      await page.locator('#clarification-submit').click();
      await page.locator('.assistant-message').nth(1).waitFor(); await ready();
      assert.match(await page.locator('#file-knowledge').textContent(), /老师/);
      assert.match(requests.at(-1).message, /关于“.*我的补充是：我是老师/s);
      assert.equal(await page.locator('.assistant-message').first().locator('.clarification-trigger').first().isDisabled(), true);
    });
    await check('个人判断优先展示，阅读要求实际发给模型', async () => {
      assert.equal(await page.locator('.file-summary').first().isVisible(), false);
      assert.equal(await page.locator('.file-overview').count(), 1);
      assert.equal(await page.locator('.personal-focus').isVisible(), true);
      for (const request of requests) {
        assert.match(request.message, /结合已知身份、方向或约束/);
        assert.match(request.message, /其他文件的资格、日期和要求勿套到本文件/);
        assert.ok(request.message.length <= 4000);
      }
      assert.equal(await page.locator('.user-message .reading-preference').count(), 2);
    });
    await check('移动端原文弹窗与回答框可完整操作', async () => {
      for (const width of [768, 390, 320]) {
        await page.setViewportSize({ width, height: 844 });
        await page.locator('.highlight-source').last().click();
        await page.locator('#source-dialog').waitFor({ state: 'visible' });
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
        await page.locator('[data-close="source-dialog"]').click();
        await page.locator('.assistant-message').last().locator('.agent-question.clarification-trigger').first().click();
        await page.locator('#clarification-dialog').waitFor({ state: 'visible' });
        assert.equal(await page.evaluate(() => document.querySelector('#clarification-dialog').scrollWidth <= document.querySelector('#clarification-dialog').clientWidth), true);
        await page.locator('#clarification-skip').click();
      }
      await page.setViewportSize({ width: 390, height: 844 });
      await page.locator('.highlight-source').last().click();
      await page.screenshot({ path: '/tmp/fileaction-feedback-source-mobile.png' });
      await page.locator('[data-close="source-dialog"]').click();
      await page.locator('.assistant-message').last().locator('.agent-question.clarification-trigger').first().click();
      await page.screenshot({ path: '/tmp/fileaction-feedback-question-mobile.png' });
      await page.locator('#clarification-skip').click();
    });
    console.log(JSON.stringify(checks, null, 2));
    await fs.writeFile('/tmp/fileaction-feedback-browser-verification.json', JSON.stringify(checks, null, 2));
    if (checks.some(check => !check.passed)) process.exitCode = 1;
  } finally {
    if (workspace) await page.evaluate(async id => {
      const headers = { 'Content-Type': 'application/json', 'X-FileAction-Token': document.querySelector('meta[name="fileaction-token"]').content };
      await fetch('/api/workspace/delete', { method: 'POST', headers, body: JSON.stringify({ file_id: id, consent: true }) });
    }, workspace).catch(() => {});
    await browser.close();
  }
})().catch(error => { console.error(error.message); process.exit(1); });
