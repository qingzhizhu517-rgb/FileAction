const { chromium } = require(process.env.PLAYWRIGHT_MODULE);
const assert = require('node:assert/strict');

(async () => {
  const browser = await chromium.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true });
  const errors = [];
  const watch = page => {
    page.on('pageerror', error => errors.push(error.message));
    page.on('response', response => {
      if (response.status() >= 400) errors.push(`${response.status()} ${response.url()}`);
    });
  };
  const base = process.env.CHECK_BASE;
  const checkMarkdownDownload = async (page, link, expected) => {
    const [download] = await Promise.all([page.waitForEvent('download'), link.click()]);
    assert.equal(await download.failure(), null);
    assert.ok(download.suggestedFilename().endsWith('.md'));
    const stream = await download.createReadStream();
    const chunks = [];
    for await (const chunk of stream) chunks.push(chunk);
    assert.ok(Buffer.concat(chunks).toString('utf8').includes(expected));
  };
  try {
    for (const [width, height] of [[1440, 900], [390, 844]]) {
      const page = await browser.newPage({ viewport: { width, height }, reducedMotion: 'reduce' });
      watch(page);
      const response = await page.goto(base + '/frontend/');
      assert.equal(response.status(), 200);
      assert.equal(await page.locator('.organize-card').count(), 12);
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
      for (const key of ['scholarship', 'research', 'business']) {
        await page.locator(`button[data-radar-case="${key}"]`).click();
        await page.locator('.pitch-source-button').click();
        assert.equal(await page.locator('#pitch-evidence-dialog').getAttribute('data-case'), key);
        await page.keyboard.press('Escape');
      }
      const target = page.getByRole('link', { name: '打开预设交互体验' });
      assert.equal(await target.getAttribute('href'), '../docs/05-交互Demo/可行动事务Agent-文启高保真Demo.html');
      await Promise.all([
        page.waitForURL(url => decodeURIComponent(url.pathname).endsWith('/docs/05-交互Demo/可行动事务Agent-文启高保真Demo.html')),
        target.click(),
      ]);
      assert.ok((await page.locator('body').innerText()).includes('文启'));
      await page.close();
      console.log(`通过 ${width}×${height}：宣传页、三场景依据及 Demo 跳转。`);
    }
    const page = await browser.newPage({ reducedMotion: 'reduce' });
    watch(page);
    let response = await page.goto(base + '/docs/01-产品方案/品牌视觉/可行动事务Agent-Logo预览.html');
    assert.equal(response.status(), 200);
    assert.ok(await page.locator('img').evaluateAll(images => images.length > 0 && images.every(image => image.complete && image.naturalWidth > 0)));
    console.log('通过：Logo 预览和全部图片资源。');
    response = await page.goto(base + '/docs/05-交互Demo/可行动事务Agent-文启UI界面.html');
    assert.equal(response.status(), 200);
    await checkMarkdownDownload(page, page.locator('a[href="可行动事务Agent-交互Demo使用说明.md"]'), '两份交互 Demo');
    console.log('通过：UI 设计稿及使用说明链接。');
    response = await page.goto(process.env.CHECK_DEMO);
    assert.equal(response.status(), 200);
    assert.ok(decodeURIComponent(page.url()).endsWith('/05-交互Demo/demo-no-memory.html'));
    await page.locator('.studio-header').waitFor();
    assert.equal(await page.locator('body').getAttribute('data-mode'), 'no-memory');
    for (const mode of ['with-memory', 'no-memory']) {
      await Promise.all([
        page.waitForURL(`**/demo-${mode}.html`),
        page.locator(`.scenario-switch a[href="demo-${mode}.html"]`).click(),
      ]);
      await page.locator('.studio-header').waitFor();
      assert.equal(await page.locator('body').getAttribute('data-mode'), mode);
      const script = page.locator('.script-link');
      assert.ok((await script.getAttribute('href')).startsWith('../90-历史归档/'));
      await checkMarkdownDownload(page, script, 'Demo');
      await page.locator('.studio-header').waitFor();
    }
    await page.locator('.scenario-switch a[href="demo-with-memory.html"]').click();
    await page.locator('.studio-header').waitFor();
    await Promise.all([
      page.waitForURL('**/demo-no-memory.html'),
      page.locator('.studio-header .brand').click(),
    ]);
    await page.locator('.studio-header').waitFor();
    assert.deepEqual(errors, []);
    console.log('通过：默认入口 HTTP 200，双场景切换、归档脚本与品牌返回，无页面或资源错误。');
  } finally {
    await browser.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
