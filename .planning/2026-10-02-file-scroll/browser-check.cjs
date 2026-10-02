// 从仓库根目录运行，PLAYWRIGHT_MODULE 可指定本机 Playwright 路径。
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const output = '.planning/2026-10-02-file-scroll';
const url = 'http://127.0.0.1:8787/07-宣传页/';

(async () => {
  const browser = await chromium.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(url);
    await page.waitForTimeout(1700);
    const settle = () => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    const state = () => page.evaluate(() => {
      const hero = document.querySelector('.hero');
      const scene = document.querySelector('.hero-scroll');
      const surface = document.querySelector('.page-surface');
      const slots = [...document.querySelectorAll('.file-slot')].filter(el => el.offsetWidth);
      const heroHeight = hero.offsetHeight;
      const header = document.querySelector('.nav-wrap').offsetHeight + 1;
      return {
        progress: +hero.dataset.eraseProgress,
        top: hero.getBoundingClientRect().top,
        pin: parseFloat(scene.style.getPropertyValue('--hero-pin-top')),
        pinStart: Math.max(0, heroHeight - (innerHeight - header)),
        travel: scene.offsetHeight - heroHeight,
        surfaceTop: surface.getBoundingClientRect().top,
        wipes: slots.map(el => parseFloat(el.style.getPropertyValue('--wipe'))),
        inert: document.querySelector('.hero-copy').inert,
        visibleFiles: slots.length,
      };
    });
    async function scrollProgress(progress) {
      const data = await state();
      await page.evaluate(top => window.scrollTo({ top, behavior: 'instant' }), data.pinStart + data.travel * progress);
      await settle();
      return state();
    }
    assert.equal(await page.locator('.paper-sculpture').count(), 0);
    const initial = await state();
    assert.equal(initial.visibleFiles, 7);
    assert.ok(initial.wipes.every(value => value === 100));
    await page.screenshot({ path: `${output}/desktop-start.png` });
    await page.mouse.move(1200, 650);
    assert.notEqual(await page.locator('.hero').evaluate(el => el.style.getPropertyValue('--array-tilt-y')), '0deg');
    await page.mouse.move(20, 30);
    await page.mouse.wheel(0, 250);
    await page.waitForFunction(() => +document.querySelector('.hero').dataset.eraseProgress > .1);
    const middle = await scrollProgress(.4);
    assert.ok(Math.abs(middle.top - middle.pin) < 2, '文件擦除期间首屏保持吸附');
    assert.ok(middle.wipes[0] < middle.wipes.at(-1), '从左到右错峰擦除');
    assert.ok(middle.wipes.every(value => value > 0 && value < 100));
    assert.ok(middle.surfaceTop < initial.surfaceTop, '下方页面同步上推');
    await page.screenshot({ path: `${output}/desktop-erasing.png` });
    const erased = await scrollProgress(.83);
    assert.ok(erased.wipes.every(value => value === 0), '文件完整擦除');
    assert.ok(erased.surfaceTop < 1000 && erased.surfaceTop > 83, '下方内容正在覆盖首屏');
    await page.waitForTimeout(900);
    await page.screenshot({ path: `${output}/desktop-next-page.png` });
    const covered = await scrollProgress(1.6);
    assert.equal(covered.inert, true, '被下页完全覆盖的文案不留键盘焦点');
    const restored = await scrollProgress(0);
    assert.ok(restored.wipes.every(value => value === 100), '回滚还原全部文件');
    assert.equal(restored.inert, false);
    await page.locator('.motion-toggle').click();
    const paused = await scrollProgress(.4);
    assert.ok(paused.wipes.every(value => value === 100), '暂停时不擦除');
    await page.locator('.motion-toggle').click();
    await settle();
    assert.ok((await state()).wipes[0] < 100, '恢复后对应当前滚动进度');
    await scrollProgress(0);
    await page.locator('.hero-bottom a').click();
    await page.waitForFunction(() => Math.abs(document.querySelector('#possibilities').getBoundingClientRect().top - 98) < 5);
    await page.locator('#tab-scholarship').click();
    await page.locator('#tab-scholarship').press('ArrowRight');
    assert.equal(await page.locator('#tab-internship').getAttribute('aria-selected'), 'true');
    await page.locator('#view-source').click();
    assert.equal(await page.locator('#source-dialog').evaluate(el => el.open), true);
    await page.keyboard.press('Escape');
    const downloading = page.waitForEvent('download');
    await page.locator('#export-checklist').click();
    const download = await downloading;
    assert.match(await fs.readFile(await download.path(), 'utf8'), /实习简章/);
    await page.waitForTimeout(750);
    for (const [width, height] of [[320, 568], [390, 844], [768, 1024], [1024, 768], [1440, 900]]) {
      await page.setViewportSize({ width, height });
      await settle();
      for (const progress of [0, .4, .83]) {
        await scrollProgress(progress);
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, `无横向溢出 ${width}×${height} / ${progress}`);
      }
    }
    await page.setViewportSize({ width: 390, height: 844 });
    await settle();
    await scrollProgress(0);
    await page.waitForFunction(() => !document.querySelector('#toast').classList.contains('visible'));
    await page.waitForTimeout(1000);
    assert.equal((await state()).visibleFiles, 5);
    await page.screenshot({ path: `${output}/mobile-start.png` });
    await scrollProgress(.4);
    await page.screenshot({ path: `${output}/mobile-erasing.png` });
    await scrollProgress(.83);
    await page.waitForTimeout(900);
    await page.screenshot({ path: `${output}/mobile-next-page.png` });
    await page.locator('.menu-toggle').click();
    assert.equal(await page.locator('#mobile-nav').isVisible(), true);
    await page.locator('#mobile-nav a').first().click();
    assert.equal(await page.locator('#mobile-nav').isVisible(), false);
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await settle();
    assert.equal(await page.locator('html').evaluate(el => el.classList.contains('scroll-linked')), false);
    assert.equal(await page.locator('.hero').evaluate(el => getComputedStyle(el).position), 'relative');
    assert.equal(await page.locator('.file-sheet').first().evaluate(el => getComputedStyle(el).clipPath), 'none');
    assert.equal(await page.locator('.hero-copy').evaluate(el => el.inert), false);
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await settle();
    assert.equal(await page.locator('.hero').evaluate(el => getComputedStyle(el).position), 'sticky');
    const noJS = await browser.newPage({ javaScriptEnabled: false });
    await noJS.goto(url);
    assert.equal(await noJS.locator('.hero').evaluate(el => getComputedStyle(el).position), 'relative');
    assert.equal(await noJS.locator('.file-slot-featured').isVisible(), true);
    assert.equal(await noJS.locator('#possibilities').isVisible(), true);
    await noJS.close();
    assert.deepEqual(errors, []);
    console.log('通过：七文件阵列、指针响应、真实滚轮、首屏吸附、错峰擦除、下页上推、回滚还原、暂停恢复、锚点、既有场景/弹窗/下载、五种尺寸三阶段无溢出、移动导航、动态减少动画偏好、无 JS 回退。');
  } finally {
    await browser.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
