// 从仓库根目录运行；PLAYWRIGHT_MODULE 指向本机 Playwright。
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const url = 'http://127.0.0.1:8787/07-宣传页/';
const output = '.planning/2026-10-02-trusted-reuse/verified';
fs.mkdirSync(output, { recursive: true });

(async () => {
  const browser = await chromium.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    const errors = [];
    const observe = target => {
      target.on('pageerror', e => errors.push(e.message));
      target.on('response', r => { if (r.status() >= 400) errors.push(`${r.status()} ${r.url()}`); });
    };
    observe(page);
    const settle = () => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(() => requestAnimationFrame(resolve)))));
    await page.goto(url);
    await page.evaluate(() => document.fonts.ready);
    await settle();
    assert.ok(await page.evaluate(() => { const s = document.querySelector('.trust-scene'); return s.previousElementSibling.id === 'opportunity-radar' && s.nextElementSibling.id === 'possibilities'; }), '第四屏位置正确');
    async function at(progress) {
      await page.evaluate(progress => {
        const s = document.querySelector('.trust-scene');
        const start = s.getBoundingClientRect().top + scrollY - parseFloat(s.style.getPropertyValue('--trust-pin-top'));
        const travel = parseFloat(s.style.getPropertyValue('--trust-scene-height')) - s.querySelector('.trust-sticky').offsetHeight;
        scrollTo({ top: start + travel * progress, behavior: 'instant' });
      }, progress);
      await settle();
    }
    async function read() {
      return page.evaluate(() => {
        const scene = document.querySelector('.trust-scene');
        const header = document.querySelector('.site-header').getBoundingClientRect().bottom;
        const bench = scene.querySelector('.trust-workbench').getBoundingClientRect();
        const cards = [...scene.querySelectorAll('.trust-card')];
        return {
          progress: +scene.dataset.trustProgress, phase: scene.dataset.trustPhase,
          overflow: document.documentElement.scrollWidth > innerWidth,
          benchFits: bench.top >= header - 1 && bench.bottom <= innerHeight + 1,
          equation: +getComputedStyle(scene.querySelector('.trust-equation')).opacity,
          checks: scene.querySelectorAll('.trust-checkpoints .is-checked').length,
          cards: cards.map(card => {
            const r = card.getBoundingClientRect();
            return { key: card.dataset.trustMaterial, transform: card.style.transform, verified: card.dataset.verified, state: card.dataset.trustState,
              verdict: +getComputedStyle(card.querySelector('.trust-verdict')).opacity,
              facts: [...card.querySelectorAll('.trust-facts > div')].map(row => +getComputedStyle(row).opacity),
              inert: card.querySelector('button').inert,
              fits: r.left >= bench.left - 1 && r.right <= bench.right + 1 && r.top >= bench.top - 1 && r.bottom <= bench.bottom + 1,
              clipped: [...card.querySelectorAll('h3,dd,p,button')].some(e => { const b = e.getBoundingClientRect(); return e.scrollWidth > e.clientWidth + 1 || b.bottom > r.bottom - 1; }),
            };
          }),
        };
      });
    }
    for (const [width, height] of [[1440, 900], [1024, 768], [768, 1024], [390, 844], [320, 568]]) {
      await page.setViewportSize({ width, height });
      await settle();
      let previous;
      for (const progress of [0, .17, .4, .65, .78, 1]) {
        await at(progress);
        const state = await read();
        assert.ok(Math.abs(state.progress - progress) < .002, '画面与原生滚动一致');
        assert.ok(!state.overflow && state.benchFits, `画板完整可见 ${width} ${progress}`);
        if (progress === 0) assert.ok(state.cards.every(card => card.verdict === 0 && card.inert && card.facts.every(opacity => opacity === 0)));
        if (previous) state.cards.forEach((card, index) => {
          assert.ok(card.verdict >= previous.cards[index].verdict);
          card.facts.forEach((opacity, j) => assert.ok(opacity >= previous.cards[index].facts[j]));
        });
        if (progress === .78) assert.ok(state.cards[0].verdict > state.cards[2].verdict, '判断错峰落印');
        if (progress === 1) {
          assert.equal(state.checks, 4);
          assert.equal(state.equation, 1);
          assert.deepEqual(state.cards.map(c => c.state), ['ready', 'warning', 'blocked']);
          assert.ok(state.cards.every(card => card.fits && !card.clipped && card.verdict === 1 && !card.inert && card.verified === 'true' && card.facts.every(opacity => opacity === 1)), `三态内容完整 ${width}`);
        }
        if ([0, .4, 1].includes(progress)) await page.screenshot({ path: `${output}/${width}-${progress}.png` });
        previous = state;
      }
      await at(.4);
      assert.ok((await read()).cards.every(card => card.verdict === 0), '回滚收起三态判断');
      await at(0);
      assert.ok((await read()).cards.every(card => card.facts.every(opacity => opacity === 0)), '回滚隐藏核对细节');
      await at(1);
      for (const key of ['project', 'roster', 'award']) {
        const button = page.locator(`[data-trust-evidence="${key}"]`);
        await button.click();
        const dialog = page.locator('#reuse-source-dialog');
        assert.ok(await dialog.evaluate(e => e.open));
        assert.equal(await dialog.locator('.trust-source-paper').count(), 2);
        assert.equal(await dialog.locator('mark').count(), 2);
        assert.ok(await dialog.evaluate(e => e.scrollWidth <= e.clientWidth + 1));
        assert.ok(await page.evaluate(() => document.body.classList.contains('modal-open')));
        if (key === 'award') {
          const controls = dialog.locator('[data-proof-toggle]');
          const result = dialog.locator('.trust-proof-result');
          assert.equal(await result.getAttribute('data-state'), 'blocked');
          await controls.nth(0).click();
          assert.equal(await result.getAttribute('data-state'), 'warning');
          await controls.nth(1).click();
          assert.equal(await result.getAttribute('data-state'), 'warning');
          await controls.nth(0).click();
          assert.equal(await result.getAttribute('data-state'), 'warning');
          await controls.nth(1).click();
          assert.equal(await result.getAttribute('data-state'), 'blocked');
          if ([1440, 390].includes(width)) await page.screenshot({ path: `${output}/${width}-evidence.png` });
          await controls.nth(0).click();
        } else assert.ok(await dialog.locator('.trust-proof-lab').evaluate(e => e.hidden));
        await page.keyboard.press('Escape');
        await page.waitForFunction(() => !document.body.classList.contains('modal-open'));
        assert.ok(!(await dialog.evaluate(e => e.open)));
        assert.ok(await button.evaluate(e => document.activeElement === e), '焦点返回打开按钮');
        assert.ok(await page.evaluate(() => !document.body.classList.contains('modal-open')));
      }
      await page.locator('[data-trust-evidence="award"]').click();
      assert.equal(await page.locator('.trust-proof-result').getAttribute('data-state'), 'blocked', '重新打开实验复位');
      await page.locator('.trust-close').click();
      console.log(`通过：${width}×${height} 六阶段展开核验/三态落印/回滚/原文弹窗/四种依据组合，无溢出裁字。`);
    }
    await page.setViewportSize({ width: 1440, height: 900 });
    await settle();
    await at(.45);
    await page.locator('.motion-toggle').click();
    const frozen = await read();
    await at(.8);
    assert.equal((await read()).progress, frozen.progress);
    assert.deepEqual((await read()).cards, frozen.cards);
    await page.locator('.motion-toggle').click();
    await settle();
    assert.ok((await read()).progress > frozen.progress);
    await at(.45);
    const beforeWheel = (await read()).progress;
    await page.mouse.move(700, 500);
    await page.mouse.wheel(0, 130);
    await page.waitForTimeout(180);
    assert.ok((await read()).progress > beforeWheel);
    await at(.45);
    await page.reload();
    await page.waitForTimeout(300);
    assert.ok(Math.abs((await read()).progress - .45) < .03, '刷新恢复当前位置');
    await at(1);
    await page.locator('[data-trust-evidence="project"]').focus();
    await page.keyboard.press('Enter');
    await page.keyboard.press('Shift+Tab');
    assert.ok(await page.evaluate(() => document.querySelector('#reuse-source-dialog').contains(document.activeElement)), '模态弹窗焦点约束');
    await page.mouse.click(4, 4);
    assert.ok(!(await page.locator('#reuse-source-dialog').evaluate(e => e.open)), '遮罩关闭');
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await settle();
    assert.equal(await page.locator('.trust-sticky').evaluate(e => getComputedStyle(e).position), 'relative');
    assert.ok((await read()).cards.every(c => c.verdict === 1 && !c.inert));
    await page.setViewportSize({ width: 320, height: 568 });
    await settle();
    await page.locator('[data-trust-evidence="award"]').click();
    assert.ok(await page.locator('#reuse-source-dialog').evaluate(e => e.open));
    await page.keyboard.press('Escape');
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await settle();
    await at(0);
    assert.ok((await read()).cards.every(c => c.verdict === 0));
    const noJS = await browser.newPage({ javaScriptEnabled: false, viewport: { width: 320, height: 568 } });
    observe(noJS);
    await noJS.goto(url);
    assert.ok(await noJS.locator('.trust-evidence').evaluateAll(buttons => buttons.every(b => b.disabled)));
    assert.ok(await noJS.locator('.trust-verdict').evaluateAll(items => items.every(e => getComputedStyle(e).opacity === '1')));
    await noJS.locator('.trust-source-archive summary').click();
    assert.equal(await noJS.locator('.trust-source-archive').getAttribute('open'), '');
    assert.equal(await noJS.locator('.trust-source-archive mark').count(), 6);
    assert.ok(await noJS.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    await noJS.close();
    const touch = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
    observe(touch);
    await touch.goto(url);
    await touch.waitForTimeout(250);
    await touch.evaluate(() => { const s = document.querySelector('.trust-scene'); scrollTo({ top: s.getBoundingClientRect().top + scrollY - parseFloat(s.style.getPropertyValue('--trust-pin-top')) + 250, behavior: 'instant' }); });
    await touch.waitForTimeout(120);
    const touchStart = +(await touch.locator('.trust-scene').getAttribute('data-trust-progress'));
    const cdp = await touch.context().newCDPSession(touch);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: 190, y: 640 }] });
    for (const y of [590, 540, 490, 440, 390, 340]) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: 190, y }] });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await touch.waitForTimeout(200);
    assert.ok(+(await touch.locator('.trust-scene').getAttribute('data-trust-progress')) > touchStart);
    await touch.evaluate(() => { const s = document.querySelector('.trust-scene'); scrollTo({ top: s.getBoundingClientRect().top + scrollY - parseFloat(s.style.getPropertyValue('--trust-pin-top')) + parseFloat(s.style.getPropertyValue('--trust-scene-height')) - s.querySelector('.trust-sticky').offsetHeight, behavior: 'instant' }); });
    await touch.waitForTimeout(100);
    await touch.locator('[data-trust-evidence="roster"]').tap();
    assert.ok(await touch.locator('#reuse-source-dialog').evaluate(e => e.open));
    await touch.locator('.trust-close').tap();
    await touch.close();
    assert.deepEqual(errors, []);
    console.log('通过：真实滚轮与触控、暂停恢复、键盘与焦点、刷新恢复、动态减少动效、无 JS 原文回退，无浏览器错误。');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
