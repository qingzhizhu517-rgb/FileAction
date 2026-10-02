// PLAYWRIGHT_MODULE 指向本机 playwright；从仓库根目录运行。
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const assert = require('node:assert/strict');
const output = '.planning/2026-10-01-landing-effects';

(async () => {
  const browser = await chromium.launch({
    executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    headless: true,
  });
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.addInitScript(() => {
      window.particleFrames = 0;
      const clear = CanvasRenderingContext2D.prototype.clearRect;
      CanvasRenderingContext2D.prototype.clearRect = function (...args) {
        if (this.canvas.classList.contains('hero-particles')) window.particleFrames++;
        return clear.apply(this, args);
      };
    });
    await page.goto('http://127.0.0.1:8787/07-宣传页/');
    await page.waitForFunction(() => window.particleFrames > 5);
    await page.mouse.move(1100, 700);
    assert.notEqual(await page.locator('.hero').evaluate(el => el.style.getPropertyValue('--plane-y')), '0deg');
    await page.waitForTimeout(1500);
    await page.screenshot({ path: `${output}/desktop.png` });
    await page.locator('.motion-toggle').click();
    const frozen = await page.evaluate(() => window.particleFrames);
    await page.waitForTimeout(350);
    assert.equal(await page.evaluate(() => window.particleFrames), frozen, '暂停后 Canvas 停帧');
    assert.equal(await page.locator('.paper-sculpture').evaluate(el => getComputedStyle(el).animationPlayState), 'paused');
    await page.locator('.motion-toggle').click();
    await page.waitForFunction(count => window.particleFrames > count + 2, frozen);
    await page.locator('.feature-card').first().scrollIntoViewIfNeeded();
    await page.locator('.feature-card').first().hover();
    assert.notEqual(await page.locator('.feature-card').first().evaluate(el => el.style.getPropertyValue('--spot-x')), '');
    await page.locator('#tab-scholarship').click();
    assert.match(await page.locator('#answer-title').innerText(), /先确认一个条件/);
    assert.equal(await page.locator('.scan-beam').count(), 1);
    await page.locator('#tab-internship').click();
    assert.equal(await page.locator('.scan-beam').count(), 1, '快速切换不叠加扫描层');
    await page.waitForTimeout(1200);
    assert.equal(await page.locator('.scan-beam').count(), 0, '扫描层结束后清理');
    const offscreen = await page.evaluate(() => window.particleFrames);
    await page.waitForTimeout(300);
    assert.equal(await page.evaluate(() => window.particleFrames), offscreen, '首屏离屏后停帧');
    await page.screenshot({ path: `${output}/experience.png` });
    await page.locator('#view-source').click();
    assert.equal(await page.locator('#source-dialog').evaluate(el => el.open), true);
    await page.keyboard.press('Escape');
    const downloadPromise = page.waitForEvent('download');
    await page.locator('#export-checklist').click();
    assert.match((await downloadPromise).suggestedFilename(), /实习简章/);
    await page.waitForTimeout(750);
    assert.equal(await page.locator('.click-spark').count(), 0, '点击粒子清理');
    for (const width of [320, 390, 768, 1024, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      const overflow = await page.evaluate(() => ({ width: innerWidth, scroll: document.documentElement.scrollWidth, elements: [...document.querySelectorAll('body *')].map(el => ({ name: el.tagName, cls: el.getAttribute('class'), rect: el.getBoundingClientRect() })).filter(el => el.rect.right > innerWidth + 1).map(el => ({ name: el.name, cls: el.cls, right: el.rect.right })) }));
      assert.equal(overflow.scroll <= overflow.width, true, `无横向溢出：${width} ${JSON.stringify(overflow)}`);
    }
    await page.setViewportSize({ width: 390, height: 844 });
    await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }));
    await page.waitForTimeout(500);
    await page.screenshot({ path: `${output}/mobile.png` });
    await page.locator('.menu-toggle').click();
    assert.equal(await page.locator('#mobile-nav').isVisible(), true);
    await page.locator('#mobile-nav a').first().click();
    assert.equal(await page.locator('#mobile-nav').isVisible(), false);
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }));
    await page.waitForTimeout(150);
    const reduced = await page.evaluate(() => window.particleFrames);
    await page.waitForTimeout(300);
    assert.equal(await page.evaluate(() => window.particleFrames), reduced);
    assert.equal(await page.locator('.hero-particles').isVisible(), false);
    assert.equal(await page.locator('.motion-toggle').isVisible(), false);
    await page.locator('#tab-competition').click();
    assert.equal(await page.locator('.scan-beam').count(), 0);
    assert.equal(await page.locator('#answer-title').evaluate(el => getComputedStyle(el).opacity), '1');
    const noJS = await browser.newPage({ javaScriptEnabled: false });
    await noJS.goto('http://127.0.0.1:8787/07-宣传页/');
    assert.equal(await noJS.locator('.feature-card').first().isVisible(), true);
    await noJS.close();
    assert.deepEqual(errors, []);
    console.log('通过：连续粒子绘制、3D 指针响应、暂停/恢复、卡片聚光、场景扫描与快速切换清理、离屏停帧、弹窗/下载、点击粒子清理、五种宽度、移动导航、动态减少动画偏好、无 JS 内容可见。');
  } finally {
    await browser.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
