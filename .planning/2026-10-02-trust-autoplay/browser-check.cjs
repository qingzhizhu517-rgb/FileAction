// 从仓库根目录运行；PLAYWRIGHT_MODULE 指向本机 Playwright。
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const url = 'http://127.0.0.1:8787/07-宣传页/';
const output = '.planning/2026-10-02-trust-autoplay/verified';
fs.mkdirSync(output, { recursive: true });

(async () => {
  const browser = await chromium.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true });
  try {
    const errors = [];
    const observe = page => {
      page.on('pageerror', error => errors.push(error.message));
      page.on('response', response => { if (response.status() >= 400) errors.push(`${response.status()}: ${response.url()}`); });
    };
    const progress = page => page.locator('.trust-scene').evaluate(el => +el.dataset.trustProgress);
    async function enter(page) {
      await page.evaluate(() => {
        const scene = document.querySelector('.trust-scene');
        const panel = scene.querySelector('.trust-sticky');
        const header = document.querySelector('.nav-wrap').getBoundingClientRect().bottom;
        const lead = Math.max(0, panel.offsetHeight - (innerHeight - header));
        scrollTo({ top: scene.getBoundingClientRect().top + scrollY - header + lead, behavior: 'instant' });
      });
      await page.waitForFunction(() => ['playing', 'complete', 'static'].includes(document.querySelector('.trust-scene').dataset.trustPlayback));
    }
    const complete = page => page.waitForFunction(() => document.querySelector('.trust-scene').dataset.trustPlayback === 'complete', null, { timeout: 9000 });
    for (const [width, height] of [[1440, 900], [1024, 768], [768, 1024], [390, 844], [320, 568]]) {
      const page = await browser.newPage({ viewport: { width, height } });
      observe(page);
      await page.goto(url);
      await page.evaluate(() => document.fonts.ready);
      await page.waitForTimeout(200);
      assert.equal(await progress(page), 0, '未入场不提前播放');
      assert.ok(await page.locator('.trust-scene').evaluate(scene => {
        const panel = scene.querySelector('.trust-sticky');
        return getComputedStyle(panel).position === 'relative' && Math.abs(scene.offsetHeight - panel.offsetHeight) <= 2;
      }), '普通文档流，无吸附和额外滚动距离');
      await enter(page);
      const scroll = await page.evaluate(() => scrollY);
      await page.waitForFunction(() => +document.querySelector('.trust-scene').dataset.trustProgress > .35);
      assert.equal(await page.evaluate(() => scrollY), scroll, '不继续滚动也能推进');
      await page.screenshot({ path: `${output}/${width}-playing.png` });
      await complete(page);
      assert.equal(await progress(page), 1);
      assert.equal(await page.evaluate(() => scrollY), scroll, '动画不强制滚动');
      assert.ok(await page.evaluate(() => {
        const scene = document.querySelector('.trust-scene');
        const bench = scene.querySelector('.trust-workbench').getBoundingClientRect();
        const header = document.querySelector('.site-header').getBoundingClientRect().bottom;
        const cards = [...scene.querySelectorAll('.trust-card')];
        return document.documentElement.scrollWidth <= innerWidth && bench.top >= header - 1 && bench.bottom <= innerHeight + 1
          && cards.every(card => card.dataset.verified === 'true' && !card.querySelector('button').inert
            && getComputedStyle(card.querySelector('.trust-verdict')).opacity === '1'
            && [...card.querySelectorAll('h3,dd,p,button')].every(e => e.scrollWidth <= e.clientWidth + 1 && e.getBoundingClientRect().bottom <= card.getBoundingClientRect().bottom - 1))
          && scene.querySelectorAll('.trust-checkpoints .is-checked').length === 4
          && getComputedStyle(scene.querySelector('.trust-equation')).opacity === '1'
          && scene.nextElementSibling.id === 'closing';
      }), `三态完整、无裁字且衔接收尾 ${width}`);
      await page.screenshot({ path: `${output}/${width}-complete.png` });
      await page.evaluate(() => scrollTo({ top: 0, behavior: 'instant' }));
      await page.waitForTimeout(100);
      await enter(page);
      assert.equal(await progress(page), 1, '回访保留结果，不随回滚倒放');
      for (const key of ['project', 'roster', 'award']) {
        const button = page.locator(`[data-trust-evidence="${key}"]`);
        await button.click();
        const dialog = page.locator('#reuse-source-dialog');
        assert.ok(await dialog.evaluate(e => e.open && e.scrollWidth <= e.clientWidth + 1));
        assert.equal(await dialog.locator('mark').count(), 2);
        if (key === 'award') {
          const controls = dialog.locator('[data-proof-toggle]');
          const state = () => dialog.locator('.trust-proof-result').getAttribute('data-state');
          assert.equal(await state(), 'blocked');
          await controls.nth(0).click();
          assert.equal(await state(), 'warning');
          await controls.nth(1).click();
          assert.equal(await state(), 'warning');
          await controls.nth(0).click();
          assert.equal(await state(), 'warning');
          await controls.nth(1).click();
          assert.equal(await state(), 'blocked');
        }
        await page.keyboard.press('Escape');
        await page.waitForFunction(() => !document.body.classList.contains('modal-open'));
        assert.ok(await button.evaluate(e => document.activeElement === e));
      }
      await page.close();
      console.log(`通过：${width}×${height} 入场自动播放、无长滚动占位、完整三态、原文及依据实验、回访保留结果。`);
    }
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    observe(page);
    await page.goto(url + '#trusted-reuse');
    await page.waitForFunction(() => +document.querySelector('.trust-scene').dataset.trustProgress > .2);
    await page.locator('.motion-toggle').click();
    const frozen = await progress(page);
    await page.waitForTimeout(450);
    assert.equal(await progress(page), frozen, '暂停冻结时间线');
    await page.mouse.wheel(0, 50);
    await page.waitForTimeout(150);
    assert.equal(await progress(page), frozen, '滚轮不控制时间线');
    await page.locator('.motion-toggle').click();
    await page.waitForTimeout(250);
    assert.ok(await progress(page) > frozen);
    await page.evaluate(() => scrollTo({ top: 0, behavior: 'instant' }));
    await page.waitForTimeout(100);
    const offscreen = await progress(page);
    await page.waitForTimeout(450);
    assert.equal(await progress(page), offscreen, '离屏冻结');
    await enter(page);
    await page.waitForTimeout(200);
    assert.ok(await progress(page) > offscreen && await progress(page) < offscreen + .1, '返回时继续，不补播离屏时间');
    await page.waitForFunction(() => +document.querySelector('.trust-scene').dataset.trustProgress > .78);
    await page.locator('[data-trust-evidence="project"]').click();
    const inModal = await progress(page);
    await page.waitForTimeout(500);
    assert.equal(await progress(page), inModal, '打开原文暂停后续动画');
    await page.keyboard.press('Shift+Tab');
    assert.ok(await page.evaluate(() => document.querySelector('#reuse-source-dialog').contains(document.activeElement)));
    await page.keyboard.press('Escape');
    await complete(page);
    await page.locator('.trust-replay').click();
    assert.ok(await progress(page) < .1, '主动重播');
    assert.ok(await page.locator('.trust-replay').isDisabled());
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.waitForFunction(() => document.querySelector('.trust-scene').dataset.trustPlayback === 'static');
    assert.equal(await progress(page), 1);
    assert.ok(await page.locator('.trust-replay').isHidden());
    await page.setViewportSize({ width: 390, height: 844 });
    await page.locator('[data-trust-evidence="award"]').click();
    assert.ok(await page.locator('#reuse-source-dialog').evaluate(e => e.open));
    await page.keyboard.press('Escape');
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await enter(page);
    await page.locator('.trust-replay').click();
    await complete(page);
    await page.locator('#closing').scrollIntoViewIfNeeded();
    assert.ok(await page.locator('.closing-content').isVisible());
    await page.close();
    const noJS = await browser.newPage({ javaScriptEnabled: false, viewport: { width: 320, height: 568 } });
    observe(noJS);
    await noJS.goto(url);
    assert.ok(await noJS.locator('.trust-verdict').evaluateAll(items => items.every(e => getComputedStyle(e).opacity === '1')));
    assert.ok(await noJS.locator('.trust-evidence').evaluateAll(buttons => buttons.every(e => e.disabled)));
    await noJS.locator('.trust-source-archive summary').click();
    assert.equal(await noJS.locator('.trust-source-archive').getAttribute('open'), '');
    assert.equal(await noJS.locator('.trust-source-archive mark').count(), 6);
    assert.ok(await noJS.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    await noJS.close();
    const touch = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
    observe(touch);
    await touch.goto(url);
    await enter(touch);
    await complete(touch);
    await touch.locator('[data-trust-evidence="roster"]').tap();
    assert.ok(await touch.locator('#reuse-source-dialog').evaluate(e => e.open));
    await touch.locator('.trust-close').tap();
    await touch.waitForFunction(() => !document.body.classList.contains('modal-open'));
    await touch.locator('.trust-replay').tap();
    assert.ok(await progress(touch) < .1);
    await touch.close();
    assert.deepEqual(errors, []);
    console.log('通过：暂停恢复、离屏冻结、原文弹窗冻结与焦点、重播、减少动效、无 JS 回退、触控操作与收尾衔接，无浏览器错误。');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
