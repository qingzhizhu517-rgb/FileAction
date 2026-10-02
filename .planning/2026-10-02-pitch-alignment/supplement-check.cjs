// 补充验证首屏入口、模拟可见性事件、弹窗冻结与回滚；需本机 Chrome。
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const assert = require('node:assert/strict');
const url = 'http://127.0.0.1:8787/07-宣传页/';
const out = '.planning/2026-10-02-pitch-alignment/verified';
(async () => {
  const browser = await chromium.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true});
  const errors = [];
  const enter = (page, selector) => page.evaluate(selector => {
    const r = document.querySelector(selector).getBoundingClientRect();
    scrollTo({top:r.top+scrollY-document.querySelector('.nav-wrap').getBoundingClientRect().bottom-12,behavior:'instant'});
  },selector);
  try {
    const context = await browser.newContext({viewport:{width:1440,height:900}});
    const page = await context.newPage();
    page.on('pageerror', e => errors.push(e.message));
    await page.goto(url);
    for (const [selector,property,duration] of [['.radar-stage','radarProgress',10000],['.action-stage','actionProgress',6000]]) {
      const scene = property === 'radarProgress' ? '.opportunity-scene' : '.action-scene';
      await enter(page,selector);
      await page.waitForFunction(({scene,property}) => +document.querySelector(scene).dataset[property] > .2,{scene,property});
      // 自动化宿主无法稳定触发真实标签页隐藏；明确模拟 visibilitychange。
      await page.evaluate(() => {
        Object.defineProperty(document,'hidden',{configurable:true,get:() => true});
        document.dispatchEvent(new Event('visibilitychange'));
      });
      const value = await page.locator(scene).evaluate((e,p) => e.dataset[p],property);
      await page.waitForTimeout(400);
      assert.equal(await page.locator(scene).evaluate((e,p) => e.dataset[p],property),value,'模拟隐藏事件冻结');
      await page.evaluate(() => {
        delete document.hidden;
        document.dispatchEvent(new Event('visibilitychange'));
      });
      await page.waitForFunction(({scene,property,value}) => +document.querySelector(scene).dataset[property] > +value,{scene,property,value});
      if (property === 'actionProgress') {
        await page.evaluate(() => document.querySelector('.pitch-source-button').click());
        await page.waitForFunction(() => document.querySelector('#pitch-evidence-dialog').open);
        const stopped = await page.locator(scene).getAttribute('data-action-progress');
        await page.waitForTimeout(350);
        assert.equal(await page.locator(scene).getAttribute('data-action-progress'),stopped,'依据弹窗打开时冻结');
        await page.keyboard.press('Escape');
      }
      await page.waitForFunction(({scene,property}) => +document.querySelector(scene).dataset[property] === 1,{scene,property},{timeout:duration});
    }
    await page.evaluate(() => scrollTo({top:0,behavior:'instant'}));
    await page.waitForFunction(() => document.querySelector('.organize-scene').dataset.organizeState === 'scattered');
    assert.ok(await page.locator('.organize-insight').first().evaluate(e => getComputedStyle(e).visibility === 'hidden'),'反向滚动收回解读');
    await page.emulateMedia({reducedMotion:'reduce'});
    await page.evaluate(() => scrollTo({top:0,behavior:'instant'}));
    await page.locator('.deck-toggle').click();
    assert.equal(await page.locator('.deck-toggle').getAttribute('aria-pressed'),'true');
    await page.locator('.deck-toggle').click();
    await page.locator('.file-open').nth(0).click();
    const names = ['奖学金通知','项目经历','申报指南','与你有关','合作方案','本次积累','可编辑产物'];
    for (let index=0;index<names.length;index++) {
      assert.equal(await page.locator('#file-preview-title').textContent(),names[index]);
      if(index<names.length-1) await page.locator('.preview-pager [data-page="1"]').click();
    }
    await page.locator('.preview-explore').click();
    assert.ok(await page.locator('.file-preview').evaluate(e => !e.open));
    assert.ok(await page.locator('.action-workspace').isHidden());
    for(const [index,key] of [[2,'research'],[4,'business']]) {
      await page.evaluate(() => scrollTo({top:0,behavior:'instant'}));
      await page.locator('.file-open').nth(index).click();
      await page.locator('.preview-explore').click();
      assert.equal(await page.locator('.opportunity-scene').getAttribute('data-radar-case'),key);
      assert.equal(await page.locator('#action-case').inputValue(),key);
    }
    await page.locator('button[data-radar-case="scholarship"]').click();
    await page.locator('.pitch-source-button').click();
    await page.mouse.click(5,5);
    assert.ok(await page.locator('#pitch-evidence-dialog').evaluate(e => !e.open),'遮罩关闭');
    await page.emulateMedia({reducedMotion:'no-preference'});
    for(const [selector,name] of [['.opportunity-scene','desktop-reading'],['.action-scene','desktop-choice']]) {
      await enter(page,selector);
      await page.locator('.motion-toggle').focus();
      await page.screenshot({path:`${out}/${name}-viewport.png`});
    }
    const small = await context.newPage();
    await small.setViewportSize({width:320,height:568});
    await small.emulateMedia({reducedMotion:'reduce'});
    await small.goto(url);
    await small.locator('.menu-toggle').click();
    await small.locator('#mobile-nav a[href="#opportunity-radar"]').click();
    assert.equal(await small.locator('.menu-toggle').getAttribute('aria-expanded'),'false');
    await small.locator('.pitch-source-button').click();
    await small.locator('#pitch-answer').fill('A'.repeat(300));
    await small.locator('#pitch-confirm').click();
    await small.keyboard.press('Escape');
    await small.locator('.pitch-source-button').click();
    assert.ok(await small.locator('#pitch-answer-status').evaluate(e => e.scrollWidth <= e.clientWidth+1),'长输入不撑破手机弹窗');
    await small.screenshot({path:`${out}/mobile-evidence-viewport.png`});
    assert.deepEqual(errors,[]);
    console.log('通过：模拟可见性事件暂停续播、依据弹窗冻结、反向滚动、聚拢、七份预览、教师/业务/行动入口、遮罩关闭、移动导航与长输入。');
  } finally {await browser.close();}
})().catch(e => {console.error(e);process.exitCode=1;});
