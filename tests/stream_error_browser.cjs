/* 失败提示验收：隔离合成 HTTP 模型及浏览器网络替身，非真实 LLM。 */
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  page.setDefaultTimeout(10000);
  const checks = [];
  const ready = () => page.waitForFunction(() => !document.body.classList.contains('busy'));
  const attempt = async (name, fn) => {
    try { await fn(); checks.push({ name, passed: true }); }
    catch (e) { checks.push({ name, passed: false, error: e.message.split('\n')[0] }); }
  };
  const send = async (text) => {
    await page.locator('#chat-input').fill(text);
    await page.locator('#chat-send').click();
    await ready();
  };
  try {
    await page.goto('http://127.0.0.1:8790/');
    await page.locator('#upload-consent').check();
    await page.locator('#persist-consent').uncheck();
    await page.locator('#upload').setInputFiles({ name: `合成错误验收-${Date.now()}.txt`, mimeType: 'text/plain', buffer: Buffer.from('合成通知：申请人须提交项目成果说明、成绩单。') });
    await page.locator('.assistant-message').waitFor(); await ready();
    const memoryBefore = await page.locator('#memory-count').textContent();
    await attempt('原文校验失败在回复旁显示具体原因，未产生已保存回复', async () => {
      await send('无效引用合成测试');
      assert.match(await page.locator('.stream-failed .stream-status').last().textContent(), /模型原文引用校验失败/);
      assert.equal(await page.locator('.stream-failed .stream-status').last().getAttribute('role'), 'alert');
      assert.equal(await page.locator('.assistant-message').count(), 1);
      assert.equal(await page.locator('#memory-count').textContent(), memoryBefore);
      assert.equal(await page.locator('#retry-chat').isVisible(), true);
    });
    await attempt('连接提前结束保留具体原因，部分文字不算完成', async () => {
      await page.route('**/api/chat', route => route.fulfill({ contentType: 'application/x-ndjson', body: JSON.stringify({type:'delta',field:'response',text:'合成未完成文字'})+'\n' }));
      await send('合成连接中断');
      assert.match(await page.locator('.stream-failed .stream-status').last().textContent(), /输出连接中断/);
      assert.equal(await page.locator('.assistant-message').count(), 1);
      await page.unroute('**/api/chat');
    });
    await attempt('开始输出前的接口拒绝也显示具体原因', async () => {
      await page.route('**/api/chat', route => route.fulfill({ status:502, contentType:'application/json', body:JSON.stringify({error:'模型流式请求失败（HTTP 429）。合成额度测试。'}) }));
      await send('合成额度失败');
      assert.match(await page.locator('.stream-failed .stream-status').last().textContent(), /HTTP 429/);
      await page.unroute('**/api/chat');
    });
    await attempt('主动取消明确标记为取消，保留原有回复和档案', async () => {
      await page.setViewportSize({ width:1440, height:1050 });
      await page.locator('#chat-input').fill('延迟合成测试');
      await page.locator('#chat-send').click();
      await page.waitForFunction(() => document.body.classList.contains('busy'));
      await page.locator('#cancel').click({ force:true }); await ready();
      await page.locator('.stream-failed').last().waitFor();
      await page.waitForFunction(() => document.querySelector('.stream-failed:last-child .stream-status')?.textContent.includes('中断或超时'));
      assert.match(await page.locator('.stream-failed .stream-status').last().textContent(), /中断或超时/);
      assert.equal(await page.locator('.assistant-message').count(), 1);
      assert.equal(await page.locator('#memory-count').textContent(), memoryBefore);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    });
    console.log(JSON.stringify(checks, null, 2));
    await fs.writeFile('/tmp/fileaction-stream-error-verification.json', JSON.stringify(checks, null, 2));
    if (checks.some(c => !c.passed)) process.exitCode = 1;
  } finally { await browser.close(); }
})().catch(e => { console.error(e.stack); process.exit(1); });
