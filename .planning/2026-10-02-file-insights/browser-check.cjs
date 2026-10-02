// 从仓库根目录运行；PLAYWRIGHT_MODULE 指向本机 Playwright。
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const assert = require('node:assert/strict');
const url = 'http://127.0.0.1:8787/07-宣传页/';

(async () => {
  const browser = await chromium.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('response', response => { if (response.status() >= 400) errors.push(`${response.status()}: ${response.url()}`); });
    await page.goto(url);
    await page.waitForTimeout(400);
    const settle = () => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(() => requestAnimationFrame(resolve)))));
    const read = () => page.locator('.organize-card').evaluateAll(cards => cards.map(card => ({
      title: card.querySelector('strong').textContent,
      titleVisible: getComputedStyle(card.querySelector('strong')).visibility === 'visible',
      transform: card.style.transform, shift: card.style.getPropertyValue('--title-shift'),
      rows: [...card.querySelectorAll('.organize-insight')].map(row => ({
        opacity: +getComputedStyle(row).opacity, visibility: getComputedStyle(row).visibility,
        clip: getComputedStyle(row).clipPath, text: row.textContent,
        clipped: row.getBoundingClientRect().bottom > card.getBoundingClientRect().bottom - 1 || row.scrollWidth > row.clientWidth + 1,
      })),
      overflow: card.scrollHeight > card.clientHeight + 1,
    })));
    async function at(progress) {
      await page.evaluate(progress => {
        const scene = document.querySelector('.organize-scene');
        const start = scene.getBoundingClientRect().top + scrollY - parseFloat(scene.style.getPropertyValue('--order-pin-top'));
        const travel = parseFloat(scene.style.getPropertyValue('--order-scene-height')) - scene.querySelector('.organize-sticky').offsetHeight;
        scrollTo({ top: start + travel * progress, behavior: 'instant' });
      }, progress);
      await settle();
      return read();
    }
    for (const [width, height] of [[1440, 900], [1024, 768], [768, 1024], [390, 844], [320, 568]]) {
      await page.setViewportSize({ width, height });
      await settle();
      const initial = await at(0);
      assert.equal(initial.length, 12);
      assert.ok(initial.every(card => card.titleVisible && card.rows.length === 3 && card.rows.every(row => row.opacity === 0 && row.visibility === 'hidden')), '散落时仅显示标题');
      assert.equal(await page.locator('.organize-card .organize-meta, .organize-card .organize-lines, .organize-card .organize-card-foot').count(), 0, '不留文件类型、假文字横线或分类文字');
      let previous = initial;
      for (const progress of [.3, .5, .7, 1]) {
        const current = await at(progress);
        current.forEach((card, i) => {
          card.rows.forEach((row, j) => assert.ok(row.opacity >= previous[i].rows[j].opacity, '文字随滚动逐渐出现'));
          assert.ok(card.rows[0].opacity >= card.rows[1].opacity && card.rows[1].opacity >= card.rows[2].opacity, '先关联或可复用内容，再依据，最后下一步');
        });
        if (progress === .5) assert.ok(current.some(card => card.rows.some(row => row.opacity > 0 && row.opacity < 1)), '滚动中途存在连续渐显而非突然弹出');
        assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `无横向溢出 ${width}×${height}`);
        previous = current;
      }
      assert.ok(previous.every(card => !card.overflow && card.rows.every(row => row.opacity === 1 && row.visibility === 'visible' && !row.clipped)), `所有解读完整可见 ${width}×${height}`);
      const project = previous.find(card => card.title === '项目介绍');
      assert.match(project.rows[0].text, /可复用/);
      assert.match(project.rows[1].text, /已确认版本 v2/);
      assert.match(project.rows[2].text, /起草参赛简介/);
      assert.match(previous.find(card => card.title === '申请草稿').rows[1].text, /初稿待确认/);
      const reversed = await at(.5);
      assert.ok(reversed.some(card => card.rows[2].opacity < 1), '回滚先收起后面的解读');
      assert.deepEqual(await at(0), initial, '回滚完整恢复标题与构图');
    }
    await page.setViewportSize({ width: 1440, height: 900 });
    await settle();
    const frozen = await at(.5);
    await page.locator('.motion-toggle').click();
    assert.deepEqual(await at(.8), frozen, '暂停同时冻结文件和文字');
    await page.locator('.motion-toggle').click();
    await settle();
    assert.notDeepEqual(await read(), frozen, '恢复后与当前滚动进度同步');
    await at(0);
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await settle();
    assert.ok((await read()).every(card => card.rows.every(row => row.opacity === 1 && row.visibility === 'visible')), '减少动态效果时直接显示完整解读');
    assert.equal(await page.locator('.organize-sticky').evaluate(el => getComputedStyle(el).position), 'relative');
    const noJS = await browser.newPage({ javaScriptEnabled: false, viewport: { width: 390, height: 844 } });
    await noJS.goto(url);
    assert.equal(await noJS.locator('.organize-insight').count(), 36);
    assert.ok(await noJS.locator('.organize-insight').evaluateAll(rows => rows.every(row => getComputedStyle(row).opacity === '1' && getComputedStyle(row).visibility === 'visible')), '无 JS 时保留全部解读');
    await noJS.close();
    assert.deepEqual(errors, []);
    console.log('通过：十二文件仅标题起始、三层解读连续渐显、反向收起、五种尺寸无溢出和裁字、核心亮点文案、暂停恢复、减少动态效果、无 JS 完整回退、无浏览器错误。');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
