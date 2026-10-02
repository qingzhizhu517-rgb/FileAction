// 从仓库根目录运行；PLAYWRIGHT_MODULE 可指定本机 Playwright 路径。
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const assert = require('node:assert/strict');
const output = '.planning/2026-10-02-file-organize';
const url = 'http://127.0.0.1:8787/07-宣传页/';

(async () => {
  const browser = await chromium.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('response', response => { if (response.status() >= 400) errors.push(`${response.status()}: ${response.url()}`); });
    await page.goto(url);
    await page.waitForTimeout(900);
    const settle = () => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(() => requestAnimationFrame(resolve)))));
    const metrics = () => page.evaluate(() => {
      const scene = document.querySelector('.organize-scene');
      const panel = scene.querySelector('.organize-sticky');
      const pin = parseFloat(scene.style.getPropertyValue('--order-pin-top'));
      return { start: scene.getBoundingClientRect().top + scrollY - pin, travel: parseFloat(scene.style.getPropertyValue('--order-scene-height')) - panel.offsetHeight, pin };
    });
    const state = () => page.evaluate(() => {
      const scene = document.querySelector('.organize-scene');
      const panel = scene.querySelector('.organize-sticky').getBoundingClientRect();
      const grid = scene.querySelector('.organize-grid').getBoundingClientRect();
      const board = scene.querySelector('.organize-board').getBoundingClientRect();
      return {
        progress: +scene.dataset.organizeProgress, phase: scene.dataset.organizeState,
        count: scene.querySelector('.organize-count').textContent, top: panel.top,
        header: document.querySelector('.site-header').getBoundingClientRect().bottom,
        overflow: document.documentElement.scrollWidth > innerWidth,
        cards: [...scene.querySelectorAll('.organize-card')].map(card => {
          const rect = card.getBoundingClientRect();
          return { transform: card.style.transform, angle: Math.atan2(new DOMMatrix(getComputedStyle(card).transform).b, new DOMMatrix(getComputedStyle(card).transform).a),
            left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom,
            settled: +card.style.getPropertyValue('--settled'), height: rect.height,
            inside: rect.left >= board.left - 1 && rect.right <= board.right + 1 && rect.top >= board.top - 1 && rect.bottom <= board.bottom + 1 };
        }), gridTop: grid.top, viewportHeight: innerHeight,
      };
    });
    async function at(progress) {
      const data = await metrics();
      await page.evaluate(top => window.scrollTo({ top, behavior: 'instant' }), data.start + data.travel * progress);
      await settle();
      return state();
    }
    assert.equal(await page.locator('.page-surface > section').first().getAttribute('id'), 'file-order', '整理场景位于第二屏');
    assert.equal(await page.locator('.organize-card').count(), 12);
    for (const [width, height] of [[1440, 900], [1024, 768], [768, 1024], [390, 844], [320, 568]]) {
      await page.setViewportSize({ width, height });
      await settle();
      const initial = await at(0);
      assert.equal(initial.phase, 'scattered');
      assert.ok(initial.cards.every(card => Math.abs(card.angle) > .1), '起始文件保持不同倾角');
      await page.screenshot({ path: `${output}/${width}-scattered.png` });
      let prior = initial;
      for (const progress of [.25, .5, .75, 1]) {
        const next = await at(progress);
        assert.ok(!next.overflow, `无横向溢出 ${width}×${height} / ${progress}`);
        assert.ok(Math.abs(next.top - (await metrics()).pin) < 2, '整理期间保持吸附');
        assert.ok(next.cards.every((card, i) => Math.abs(card.angle) <= Math.abs(prior.cards[i].angle) + .001), '倾角随滚动逐步收敛');
        assert.ok(next.cards.every(card => card.inside), '文件轨迹在画板内');
        assert.ok(Math.min(...next.cards.map(card => card.top)) >= next.header - 2, `文件不被导航遮挡 ${width}×${height}`);
        assert.ok(Math.max(...next.cards.map(card => card.bottom)) <= height, '文件底部完整可见');
        if (progress === .75) assert.ok(next.cards.some(card => card.settled === 1) && next.cards.some(card => card.settled < 1), '文件错峰而非同时完成归位');
        if (progress === .5 || progress === 1) await page.screenshot({ path: `${output}/${width}-${progress === 1 ? 'ordered' : 'arranging'}.png` });
        prior = next;
      }
      assert.equal(prior.phase, 'ordered');
      assert.equal(prior.count, '12 / 12');
      assert.ok(prior.cards.every(card => Math.abs(card.angle) < .0001));
      assert.equal(new Set(prior.cards.map(card => Math.round(card.left))).size, width > 1000 ? 6 : width > 540 ? 4 : 3, '整齐排列为响应式列数');
      const restored = await at(0);
      assert.deepEqual(restored.cards.map(card => card.transform), initial.cards.map(card => card.transform), '回滚完整还原构图');
      assert.equal(restored.overflow, false);
    }
    await page.setViewportSize({ width: 1440, height: 900 });
    await settle();
    await at(.3);
    await page.mouse.wheel(0, 230);
    await page.waitForFunction(() => +document.querySelector('.organize-scene').dataset.organizeProgress > .4);
    await page.waitForTimeout(200);
    const beforePause = await state();
    await page.locator('.motion-toggle').click();
    const paused = await at(.75);
    assert.equal(paused.progress, beforePause.progress, '暂停时冻结当前位置');
    await page.locator('.motion-toggle').click();
    await settle();
    assert.ok(Math.abs((await state()).progress - .75) < .01, '恢复后对应当前滚动位置');
    await page.evaluate(() => {
      const header = document.querySelector('.nav-wrap').offsetHeight + 1;
      const lead = Math.max(0, document.querySelector('.hero').offsetHeight - (innerHeight - header));
      window.scrollTo({ top: lead, behavior: 'instant' });
    });
    await settle();
    await page.locator('.hero-bottom a').click();
    await page.waitForFunction(() => Math.abs(document.querySelector('#file-order').getBoundingClientRect().top - 98) < 5);
    assert.equal((await state()).phase, 'scattered', '首屏入口到达散落阶段');
    await at(1.2);
    assert.ok(await page.locator('#possibilities').evaluate(el => el.getBoundingClientRect().top < innerHeight), '整理完成后自然进入产品价值区');
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await settle();
    assert.equal(await page.locator('.organize-sticky').evaluate(el => getComputedStyle(el).position), 'relative');
    assert.equal((await state()).count, '12 / 12');
    assert.ok(await page.locator('.organize-card').evaluateAll(cards => cards.every(card => getComputedStyle(card).transform === 'none')));
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await settle();
    assert.equal(await page.locator('.organize-sticky').evaluate(el => getComputedStyle(el).position), 'sticky');
    await at(.5);
    await page.reload();
    await page.waitForTimeout(300);
    assert.ok(Math.abs((await state()).progress - .5) < .02, '刷新后恢复当前滚动进度');

    const noJS = await browser.newPage({ javaScriptEnabled: false, viewport: { width: 390, height: 844 } });
    await noJS.goto(url);
    assert.equal(await noJS.locator('.organize-card').count(), 12);
    assert.equal(await noJS.locator('.organize-sticky').evaluate(el => getComputedStyle(el).position), 'relative');
    assert.ok(await noJS.locator('.organize-card').evaluateAll(cards => cards.every(card => getComputedStyle(card).transform === 'none')));
    assert.ok(await noJS.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    await noJS.close();

    const mobile = await browser.newPage({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
    mobile.on('pageerror', error => errors.push(error.message));
    await mobile.goto(url);
    await mobile.waitForTimeout(300);
    await mobile.evaluate(() => {
      const scene = document.querySelector('.organize-scene');
      scrollTo({ top: scene.getBoundingClientRect().top + scrollY - parseFloat(scene.style.getPropertyValue('--order-pin-top')), behavior: 'instant' });
    });
    const session = await mobile.context().newCDPSession(mobile);
    await session.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: 195, y: 650 }] });
    await session.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: 195, y: 350 }] });
    await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await mobile.waitForFunction(() => +document.querySelector('.organize-scene').dataset.organizeProgress > .1);
    await mobile.close();
    assert.deepEqual(errors, []);
    console.log('通过：第二屏位置、十二文件、五种尺寸逐步归位/错峰/吸附/完整可见/无溢出、反向还原、真实滚轮、暂停恢复、首屏锚点、后续衔接、动态减少动效、无 JS 回退、刷新恢复、触控滑动。');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
