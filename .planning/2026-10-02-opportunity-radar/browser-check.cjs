// 从仓库根目录运行；PLAYWRIGHT_MODULE 指向本机安装的 Playwright。
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const url = 'http://127.0.0.1:8787/07-宣传页/';
const output = '.planning/2026-10-02-opportunity-radar/verified';
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
    assert.ok(await page.evaluate(() => {
      const scene = document.querySelector('#opportunity-radar');
      return scene.previousElementSibling.id === 'file-order' && scene.nextElementSibling.id === 'possibilities';
    }), '第三屏连接第二屏和产品价值区');
    async function at(progress) {
      await page.evaluate(progress => {
        const scene = document.querySelector('.opportunity-scene');
        const start = scene.getBoundingClientRect().top + scrollY - parseFloat(scene.style.getPropertyValue('--radar-pin-top'));
        const travel = parseFloat(scene.style.getPropertyValue('--radar-scene-height')) - scene.querySelector('.opportunity-sticky').offsetHeight;
        scrollTo({ top: start + travel * progress, behavior: 'instant' });
      }, progress);
      await settle();
    }
    async function state() {
      return page.evaluate(() => {
        const q = selector => document.querySelector(selector);
        const rect = element => { const r = element.getBoundingClientRect(); return { top: r.top, bottom: r.bottom, left: r.left, right: r.right }; };
        const scene = q('.opportunity-scene'), map = q('.radar-map'), notice = q('.radar-notice'), result = q('.radar-result');
        const n = rect(notice), box = rect(result), header = rect(q('.site-header')).bottom;
        const cards = [...scene.querySelectorAll('.radar-memory')];
        return {
          progress: +scene.dataset.radarProgress, phase: scene.dataset.radarPhase, key: scene.dataset.radarCase,
          overflow: document.documentElement.scrollWidth > innerWidth, mapVisible: getComputedStyle(map).visibility === 'visible',
          overlap: cards.filter(card => { const b = rect(card); return Math.min(b.right, n.right) - Math.max(b.left, n.left) > 2 && Math.min(b.bottom, n.bottom) - Math.max(b.top, n.top) > 2; }).map(card => card.dataset.radarMemory),
          lights: cards.map(card => +card.style.getPropertyValue('--memory-light')),
          resultOpacity: +getComputedStyle(result).opacity,
          rows: [...scene.querySelectorAll('.radar-result-row')].map(row => +getComputedStyle(row).opacity),
          resultVisible: box.top >= header - 1 && box.bottom <= innerHeight + 1,
          mapFits: cards.every(card => { const b = rect(card); return b.top >= header - 1 && b.bottom <= innerHeight + 1 && b.left >= 0 && b.right <= innerWidth; }),
          clipped: [...result.querySelectorAll('h3,p,li,a')].some(e => e.scrollWidth > e.clientWidth + 1),
          nextInert: q('.radar-next').inert, transform: map.style.transform,
        };
      });
    }
    for (const [width, height] of [[1440, 900], [1024, 768], [768, 1024], [390, 844], [320, 568]]) {
      await page.setViewportSize({ width, height });
      await settle();
      for (const key of ['competition', 'scholarship', 'internship']) {
        await page.locator(`button[data-radar-case="${key}"]`).evaluate(button => button.click());
        await settle();
        let previous;
        for (const progress of [0, .12, .3, .5, .64, .8, 1]) {
          await at(progress);
          const current = await state();
          assert.equal(current.key, key);
          assert.ok(Math.abs(current.progress - progress) < .002, '画面跟随原生滚动');
          assert.ok(!current.overflow && !current.clipped, `无溢出裁字 ${width} ${key} ${progress}`);
          if (current.mapVisible) {
            assert.deepEqual(current.overlap, [], `通知与背景卡片不重叠 ${width} ${key} ${progress}`);
            assert.ok(current.mapFits, `背景卡片完整可见 ${width} ${key} ${progress}`);
          }
          if (previous) current.lights.forEach((light, index) => assert.ok(light >= previous.lights[index], '背景依次点亮'));
          if (progress === 0) {
            assert.equal(current.resultOpacity, 0);
            assert.ok(current.lights.every(light => light === 0));
            assert.ok(current.nextInert, '未显现的操作不进入焦点顺序');
          }
          if (progress === .3) assert.ok(current.lights.some(light => light > 0) && current.lights.some(light => light === 0), '点亮有先后');
          if (progress === 1) {
            assert.equal(current.resultOpacity, 1);
            assert.ok(current.resultVisible && current.rows.every(opacity => opacity === 1));
            assert.ok(!current.nextInert);
          }
          if (key === 'competition' && [0, .5, 1].includes(progress)) await page.screenshot({ path: `${output}/${width}-${progress}.png` });
          previous = current;
        }
        await at(.5);
        assert.equal((await state()).resultOpacity, 0, '回滚收起机会卡片');
        await at(0);
        assert.ok((await state()).lights.every(light => light === 0), '回滚收起关联');
      }
      console.log(`通过：${width}×${height} 三类通知七阶段、错峰连线、归位结果、回滚、无裁字和重叠。`);
    }
    await page.setViewportSize({ width: 1440, height: 900 });
    await settle();
    await at(.45);
    const beforeWheel = (await state()).progress;
    await page.mouse.move(700, 500);
    await page.mouse.wheel(0, 120);
    await page.waitForTimeout(160);
    assert.ok((await state()).progress > beforeWheel, '真实滚轮推进动画');
    await at(.45);
    await page.locator('.motion-toggle').click();
    const frozen = await state();
    await at(.8);
    const paused = await state();
    assert.equal(paused.progress, frozen.progress);
    assert.deepEqual(paused.lights, frozen.lights);
    assert.equal(paused.transform, frozen.transform);
    await page.locator('.motion-toggle').click();
    await settle();
    assert.ok((await state()).progress > frozen.progress, '恢复同步当前滚动位置');
    await at(1);
    await page.locator('button[data-radar-case="competition"]').click();
    await page.locator('button[data-radar-case="competition"]').press('ArrowRight');
    assert.equal((await state()).key, 'scholarship');
    assert.match(await page.locator('#radar-missing').textContent(), /综合测评/);
    await page.locator('button[data-radar-case="scholarship"]').press('End');
    assert.equal((await state()).key, 'internship');
    assert.match(await page.locator('#radar-reason').textContent(), /教育方向实习/);
    await page.locator('button[data-radar-case="internship"]').press('Home');
    assert.equal((await state()).key, 'competition');
    for (const key of ['competition', 'scholarship', 'internship']) {
      await at(1);
      await page.locator(`button[data-radar-case="${key}"]`).click();
      await settle();
      await at(1);
      await page.locator('.radar-next').click();
      await page.waitForTimeout(650);
      assert.equal(await page.locator(`button[data-scenario="${key}"]`).getAttribute('aria-selected'), 'true', '下一步联动对应场景');
    }
    await at(.46);
    await page.reload();
    await page.waitForTimeout(250);
    assert.ok(Math.abs((await state()).progress - .46) < .025, '刷新恢复当前滚动进度');
    await at(.2);
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await settle();
    assert.equal(await page.locator('.opportunity-sticky').evaluate(e => getComputedStyle(e).position), 'relative');
    assert.equal((await state()).resultOpacity, 1);
    assert.ok((await state()).rows.every(opacity => opacity === 1));
    await page.setViewportSize({ width: 390, height: 844 });
    await settle();
    assert.ok(await page.evaluate(() => { const map = document.querySelector('.radar-map').getBoundingClientRect(), result = document.querySelector('.radar-result').getBoundingClientRect(); return result.top >= map.bottom; }), '静态手机顺序展开星图与结果');
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await settle();
    await at(0);
    assert.equal((await state()).resultOpacity, 0);
    const noJS = await browser.newPage({ javaScriptEnabled: false, viewport: { width: 320, height: 568 } });
    observe(noJS);
    await noJS.goto(url);
    assert.ok(await noJS.locator('.radar-cases button').evaluateAll(buttons => buttons.every(button => button.disabled)));
    assert.equal(await noJS.locator('.radar-result').evaluate(e => getComputedStyle(e).opacity), '1');
    assert.equal(await noJS.locator('#radar-ready li').count(), 2);
    assert.equal(await noJS.locator('#radar-missing li').count(), 2);
    assert.ok(await noJS.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    await noJS.close();
    const touch = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
    observe(touch);
    await touch.goto(url);
    await touch.waitForTimeout(250);
    await touch.locator('.radar-cases').scrollIntoViewIfNeeded();
    await touch.locator('button[data-radar-case="internship"]').tap();
    assert.equal(await touch.locator('.opportunity-scene').getAttribute('data-radar-case'), 'internship');
    await touch.evaluate(() => { const s = document.querySelector('.opportunity-scene'); scrollTo({ top: s.getBoundingClientRect().top + scrollY - parseFloat(s.style.getPropertyValue('--radar-pin-top')) + 250, behavior: 'instant' }); });
    await touch.waitForTimeout(100);
    const startProgress = +(await touch.locator('.opportunity-scene').getAttribute('data-radar-progress'));
    const cdp = await touch.context().newCDPSession(touch);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: 190, y: 620 }] });
    for (const y of [570, 520, 470, 420, 370, 320]) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: 190, y }] });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await touch.waitForTimeout(180);
    assert.ok(+(await touch.locator('.opportunity-scene').getAttribute('data-radar-progress')) > startProgress, '触控滑动推进动画');
    await touch.close();
    assert.deepEqual(errors, []);
    console.log('通过：真实滚轮和触控、暂停恢复、三通知鼠标与键盘切换、下一步场景联动、刷新恢复、减少动态效果、无 JS 回退，无浏览器错误。');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
