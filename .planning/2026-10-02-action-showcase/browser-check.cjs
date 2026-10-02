const {chromium} = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const out = '.planning/2026-10-02-action-showcase/verified';
fs.mkdirSync(out,{recursive:true});
const url = 'http://127.0.0.1:8787/07-宣传页/';
(async () => {
  const browser = await chromium.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true});
  const errors = [];
  function watch(page) {
    page.on('pageerror',e => errors.push(e.message));
    page.on('response',r => {if(r.status() >= 400) errors.push(`${r.status()} ${r.url()}`);});
  }
  async function enter(page,selector) {
    await page.evaluate(selector => {
      const e=document.querySelector(selector), header=document.querySelector('.nav-wrap');
      scrollTo({top:e.getBoundingClientRect().top+scrollY-header.getBoundingClientRect().bottom-12,behavior:'instant'});
    },selector);
  }
  async function integrity(page) {
    assert.equal(await page.locator('.action-scene select,.action-scene button,.action-scene textarea,.action-workspace,[data-artifact]').count(),0,'第四屏不再含选项或示例操作区');
    assert.equal(await page.locator('.action-context-list li').count(),3);
    assert.equal(await page.locator('.action-principles > div').count(),3);
    assert.ok(await page.locator('.action-scene').evaluate(e => e.nextElementSibling.id === 'closing'));
    assert.equal(await page.locator('footer.site-footer').count(),1);
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth+1),'页面无横向溢出');
    const clipped=await page.locator('.action-scene').evaluate(e => [...e.querySelectorAll('h2,h3,p,li,dt,dd')].filter(n => n.scrollWidth > n.clientWidth+1).map(n => n.textContent));
    assert.deepEqual(clipped,[],'文字不裁切');
    assert.ok(await page.locator('.action-outcome').evaluate(e => getComputedStyle(e).opacity==='1'));
    assert.ok(await page.locator('.action-principles > div').last().evaluate(e => getComputedStyle(e).opacity==='1'));
  }
  try {
    for(const [width,height] of [[1440,900],[1024,768],[768,1024],[390,844],[320,568]]) {
      const page=await browser.newPage({viewport:{width,height}});
      watch(page);
      await page.goto(url);
      await page.waitForFunction(() => document.querySelector('.action-scene').dataset.actionProgress === '0.0000');
      await enter(page,'.action-stage');
      const y=await page.evaluate(() => scrollY);
      await page.waitForFunction(() => document.querySelector('.action-scene').dataset.actionPlayback==='complete',null,{timeout:7000});
      assert.equal(await page.evaluate(() => scrollY),y,'自动播放不依赖继续滚动');
      await integrity(page);
      await enter(page,'.action-scene');
      await page.locator('.motion-toggle').focus();
      await page.screenshot({path:`${out}/${width}-viewport.png`});
      await page.locator('.action-scene').screenshot({path:`${out}/${width}-section.png`});
      await page.locator('#closing').scrollIntoViewIfNeeded();
      assert.ok(await page.locator('#closing a.button').isVisible());
      await page.close();
      console.log(`通过 ${width}×${height}：无选项/编辑区，自动展示完整，布局无溢出，收尾连续。`);
    }
    for(const javaScriptEnabled of [false,true]) {
      for(const width of [1440,320]) {
        const page=await browser.newPage({viewport:{width,height:900},javaScriptEnabled,reducedMotion:'reduce'});
        watch(page);
        await page.goto(url);
        await integrity(page);
        await page.close();
      }
    }
    console.log('通过：无 JavaScript、减少动态效果的桌面与手机静态回退。');
    const page=await browser.newPage({viewport:{width:1440,height:900}});
    watch(page);
    await page.goto(url);
    await enter(page,'.action-stage');
    await page.waitForFunction(() => +document.querySelector('.action-scene').dataset.actionProgress > .2);
    await page.locator('.motion-toggle').click();
    const frozen=await page.locator('.action-scene').getAttribute('data-action-progress');
    await page.waitForTimeout(250);
    assert.equal(await page.locator('.action-scene').getAttribute('data-action-progress'),frozen);
    await page.locator('.motion-toggle').click();
    await page.evaluate(() => scrollTo({top:0,behavior:'instant'}));
    await page.waitForTimeout(100);
    const offscreen=await page.locator('.action-scene').getAttribute('data-action-progress');
    await page.waitForTimeout(250);
    assert.equal(await page.locator('.action-scene').getAttribute('data-action-progress'),offscreen);
    await enter(page,'.action-stage');
    await page.waitForFunction(() => document.querySelector('.action-scene').dataset.actionPlayback==='complete');
    await page.emulateMedia({reducedMotion:'reduce'});
    for(const key of ['scholarship','research','business']) {
      await page.locator(`button[data-radar-case="${key}"]`).click();
      await page.locator('.pitch-source-button').click();
      assert.equal(await page.locator('#pitch-evidence-dialog').getAttribute('data-case'),key);
      await page.locator('#pitch-answer').fill('合成补充，仍待核实');
      await page.locator('#pitch-confirm').click();
      await page.locator('#pitch-note').fill(`${key} 本次笔记`);
      await page.locator('#pitch-keep').click();
      assert.match(await page.locator('#pitch-note-status').textContent(),/已保留当前版本/);
      await page.keyboard.press('Escape');
      await page.locator('.pitch-source-button').click();
      assert.equal(await page.locator('#pitch-note').inputValue(),`${key} 本次笔记`);
      await page.locator('#pitch-discard').click();
      await page.locator('#pitch-skip').click();
      await page.keyboard.press('Escape');
    }
    await page.locator('.radar-next').click();
    assert.ok(await page.locator('#trust-title').isVisible());
    await page.evaluate(() => scrollTo({top:0,behavior:'instant'}));
    await page.locator('.file-open').last().click();
    assert.match(await page.locator('.preview-explore').textContent(),/看看如何继续行动/);
    await page.locator('.preview-explore').click();
    assert.ok(await page.locator('.file-preview').evaluate(e => !e.open));
    await page.setViewportSize({width:390,height:844});
    await page.locator('.menu-toggle').click();
    await page.locator('#mobile-nav a[href="#trusted-reuse"]').click();
    assert.equal(await page.locator('.menu-toggle').getAttribute('aria-expanded'),'false');
    assert.deepEqual(errors,[]);
    console.log('通过：暂停/续播、离屏冻结、三场景依据与笔记、第三屏和文件预览入口、移动导航，无页面异常或资源错误。');
  } finally {await browser.close();}
})().catch(e => {console.error(e);process.exitCode=1;});
