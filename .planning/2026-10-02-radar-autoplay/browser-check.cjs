// 从仓库根目录运行；PLAYWRIGHT_MODULE 指向本机 Playwright。
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const url = 'http://127.0.0.1:8787/07-宣传页/';
const output = '.planning/2026-10-02-radar-autoplay/verified';
fs.mkdirSync(output, { recursive: true });

(async () => {
  const browser = await chromium.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true });
  try {
    const errors = [];
    const observe = page => {
      page.on('pageerror', error => errors.push(error.message));
      page.on('response', response => { if (response.status() >= 400) errors.push(`${response.status()}: ${response.url()}`); });
    };
    const progress = page => page.locator('.opportunity-scene').evaluate(el => +el.dataset.radarProgress);
    async function enter(page) {
      await page.evaluate(() => {
        const scene = document.querySelector('.opportunity-scene');
        const panel = scene.querySelector('.opportunity-sticky');
        const header = document.querySelector('.nav-wrap').getBoundingClientRect().bottom;
        // 短屏把画板移入可见区；长屏保留完整标题。
        const lead = Math.max(0, panel.offsetHeight - (innerHeight - header));
        scrollTo({ top: scene.getBoundingClientRect().top + scrollY - header + lead, behavior: 'instant' });
      });
      await page.waitForFunction(() => ['playing', 'complete', 'static'].includes(document.querySelector('.opportunity-scene').dataset.radarPlayback));
    }
    async function complete(page) {
      await page.waitForFunction(() => document.querySelector('.opportunity-scene').dataset.radarPlayback === 'complete', { timeout: 9000 });
    }
    for (const [width, height] of [[1440, 900], [1024, 768], [768, 1024], [390, 844], [320, 568]]) {
      const page = await browser.newPage({ viewport: { width, height } });
      observe(page);
      await page.goto(url);
      await page.evaluate(() => document.fonts.ready);
      await page.waitForTimeout(200);
      assert.equal(await progress(page), 0, '第三屏未入场不提前播放');
      assert.ok(await page.locator('.opportunity-scene').evaluate(scene => {
        const panel = scene.querySelector('.opportunity-sticky');
        return getComputedStyle(panel).position === 'relative' && Math.abs(scene.offsetHeight - panel.offsetHeight) <= 2;
      }), '取消吸附和额外滚动距离');
      await enter(page);
      const scroll = await page.evaluate(() => scrollY);
      await page.waitForFunction(() => +document.querySelector('.opportunity-scene').dataset.radarProgress > .32);
      assert.equal(await page.evaluate(() => scrollY), scroll, '不用继续下滑，动画仍然推进');
      await page.screenshot({ path: `${output}/${width}-playing.png` });
      await complete(page);
      assert.equal(await progress(page), 1);
      assert.equal(await page.evaluate(() => scrollY), scroll, '自动播放不强制滚动页面');
      assert.ok(await page.evaluate(() => {
        const scene = document.querySelector('.opportunity-scene');
        const result = scene.querySelector('.radar-result');
        const rect = result.getBoundingClientRect();
        const header = document.querySelector('.site-header').getBoundingClientRect().bottom;
        return document.documentElement.scrollWidth <= innerWidth && getComputedStyle(result).opacity === '1'
          && rect.top >= header - 1 && rect.bottom <= innerHeight + 1
          && [...result.querySelectorAll('.radar-result-row')].every(row => getComputedStyle(row).opacity === '1')
          && !scene.querySelector('.radar-next').inert
          && scene.nextElementSibling.id === 'trusted-reuse';
      }), `完整结果、无溢出且衔接第四屏 ${width}`);
      await page.screenshot({ path: `${output}/${width}-complete.png` });
      await page.evaluate(() => scrollTo({ top: 0, behavior: 'instant' }));
      await page.waitForTimeout(100);
      await enter(page);
      assert.equal(await progress(page), 1, '完成后返回保留结果，不随回滚倒放');
      await page.close();
      console.log(`通过：${width}×${height} 入场后静止自动播放、完整结果、无长滚动占位、回访保留结果。`);
    }
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    observe(page);
    await page.goto(url + '#opportunity-radar');
    await page.waitForFunction(() => +document.querySelector('.opportunity-scene').dataset.radarProgress > .2);
    await page.locator('.motion-toggle').click();
    const frozen = await progress(page);
    await page.waitForTimeout(550);
    assert.equal(await progress(page), frozen, '暂停冻结时间线');
    await page.mouse.wheel(0, 60);
    await page.waitForTimeout(180);
    assert.equal(await progress(page), frozen, '滚轮不改变冻结的动画进度');
    await page.locator('.motion-toggle').click();
    await page.waitForTimeout(300);
    assert.ok(await progress(page) > frozen, '恢复从原进度继续');
    await page.evaluate(() => scrollTo({ top: 0, behavior: 'instant' }));
    await page.waitForTimeout(100);
    const offscreen = await progress(page);
    await page.waitForTimeout(450);
    assert.equal(await progress(page), offscreen, '离屏暂停');
    await enter(page);
    await page.waitForTimeout(200);
    assert.ok(await progress(page) > offscreen && await progress(page) < offscreen + .1, '回到视口不补播离屏时间');
    await complete(page);
    await page.locator('button[data-radar-case="competition"]').click();
    assert.ok(await progress(page) < .1, '点击当前通知重播');
    await page.waitForTimeout(200);
    await page.locator('button[data-radar-case="scholarship"]').click();
    assert.ok(await progress(page) < .1);
    assert.match(await page.locator('#radar-missing').textContent(), /综合测评/);
    await page.locator('button[data-radar-case="scholarship"]').press('ArrowRight');
    assert.equal(await page.locator('.opportunity-scene').getAttribute('data-radar-case'), 'internship');
    assert.equal(await page.locator('.radar-next').getAttribute('href'), '#closing');
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.waitForFunction(() => document.querySelector('.opportunity-scene').dataset.radarPlayback === 'static');
    assert.equal(await progress(page), 1, '减少动效直接显示结果');
    await page.locator('button[data-radar-case="competition"]').click();
    assert.equal(await progress(page), 1, '减少动效切换仍保持完整结果');
    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForTimeout(100);
    assert.ok(await page.evaluate(() => document.querySelector('.radar-result').getBoundingClientRect().top >= document.querySelector('.radar-map').getBoundingClientRect().bottom), '减少动效手机版顺序排版');
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await page.waitForTimeout(100);
    await enter(page);
    await page.locator('button[data-radar-case="competition"]').click();
    await complete(page);
    await page.locator('.radar-next').click();
    await page.waitForTimeout(800);
    assert.equal(await page.evaluate(() => location.hash), '#trusted-reuse');
    await page.close();
    const noJS = await browser.newPage({ javaScriptEnabled: false, viewport: { width: 390, height: 844 } });
    observe(noJS);
    await noJS.goto(url);
    assert.equal(await noJS.locator('.radar-result').evaluate(el => getComputedStyle(el).opacity), '1');
    assert.ok(await noJS.locator('.radar-cases button').evaluateAll(items => items.every(el => el.disabled)));
    await noJS.close();
    assert.deepEqual(errors, []);
    console.log('通过：锚点直接入场、暂停恢复、离屏冻结、重播与键盘切换、减少动效、无 JS 回退、第四屏跳转，无浏览器错误。');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
