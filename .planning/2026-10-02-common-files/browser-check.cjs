const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const out = '.planning/2026-10-02-common-files/verified';
const titles = ['放假通知','会议通知','考试安排','招聘通知','培训通知','奖学金申请通知','活动策划方案','项目实施方案','合作方案','工作计划','宣传推广方案','项目预算表'];
const focus = ['招聘通知','奖学金申请通知','项目实施方案','合作方案'];
fs.mkdirSync(out,{recursive:true});
(async () => {
  const browser = await chromium.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true});
  const errors = [];
  const watch = page => {
    page.on('pageerror',e => errors.push(e.message));
    page.on('response',r => {if(r.status() >= 400) errors.push(`${r.status()} ${r.url()}`);});
  };
  async function scrollProgress(page,progress) {
    await page.evaluate(progress => {
      const s=document.querySelector('.organize-scene'),p=s.querySelector('.organize-sticky');
      const travel=parseFloat(s.style.getPropertyValue('--order-scene-height'))-p.offsetHeight;
      const start=s.getBoundingClientRect().top+scrollY-parseFloat(s.style.getPropertyValue('--order-pin-top'));
      scrollTo({top:start+travel*progress,behavior:'instant'});
    },progress);
  }
  async function inspect(page) {
    assert.deepEqual(await page.locator('.organize-card > strong').allTextContents(),titles);
    assert.deepEqual(await page.locator('.organize-card[data-reading-focus="true"] > strong').allTextContents(),focus);
    assert.equal(await page.locator('.organize-insight').count(),36);
    assert.equal(await page.locator('.organize-count').textContent(),'4 类重点');
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth+1),'无页面横向溢出');
    const clipped=await page.locator('.organize-card').evaluateAll(cards => cards.flatMap(card => {
      const r=card.getBoundingClientRect();
      return [...card.querySelectorAll('strong,.organize-insight > span,.organize-insight > b')].filter(e => {
        const t=e.getBoundingClientRect();
        return e.scrollWidth > e.clientWidth+1 || t.right > r.right+1 || t.bottom > r.bottom-1;
      }).map(e => e.textContent);
    }));
    assert.deepEqual(clipped,[],'卡片标题和末行解读不被裁切');
    assert.ok(await page.locator('.action-scene').evaluate(e => e.nextElementSibling.id==='closing'));
    assert.equal(await page.locator('.action-scene select,.action-scene textarea,.action-scene button').count(),0);
  }
  try {
    for(const [width,height] of [[1440,900],[1024,768],[768,1024],[390,844],[320,568]]) {
      const page=await browser.newPage({viewport:{width,height}});
      watch(page);
      await page.goto('http://127.0.0.1:8787/07-宣传页/');
      await page.waitForFunction(() => document.querySelector('.organize-scene').dataset.organizeState==='scattered');
      assert.equal(await page.locator('.organize-count').textContent(),'12 类文件');
      await scrollProgress(page,.45);
      await page.waitForFunction(() => document.querySelector('.organize-scene').dataset.organizeState==='arranging');
      await scrollProgress(page,1);
      await page.waitForFunction(() => document.querySelector('.organize-scene').dataset.organizeState==='ordered');
      await inspect(page);
      // 单独检查画板内容时隐藏浮层，避免固定导航遮挡长画板截图。
      await page.locator('.site-header').evaluate(e => e.style.visibility='hidden');
      await page.locator('.organize-board').screenshot({path:`${out}/${width}-files.png`});
      await page.locator('.site-header').evaluate(e => e.style.removeProperty('visibility'));
      await page.evaluate(() => scrollTo({top:0,behavior:'instant'}));
      await page.waitForFunction(() => document.querySelector('.organize-scene').dataset.organizeState==='scattered');
      assert.ok(await page.locator('.organize-insight').first().evaluate(e => getComputedStyle(e).visibility==='hidden'));
      if(width===1440) {
        for(const [stage,scene,property] of [['.radar-stage','.opportunity-scene','radarPlayback'],['.action-stage','.action-scene','actionPlayback']]) {
          await page.locator(stage).scrollIntoViewIfNeeded();
          await page.waitForFunction(({scene,property}) => document.querySelector(scene).dataset[property]==='complete',{scene,property},{timeout:10000});
        }
      }
      await page.close();
      console.log(`通过 ${width}×${height}：12 类文件、4 类重点、36 条解读、标题/正文完整、滚动渐显和回滚。`);
    }
    for(const javaScriptEnabled of [false,true]) {
      const page=await browser.newPage({viewport:{width:320,height:568},javaScriptEnabled,reducedMotion:'reduce'});
      watch(page);
      await page.goto('http://127.0.0.1:8787/07-宣传页/');
      await inspect(page);
      await page.close();
    }
    assert.deepEqual(errors,[]);
    console.log('通过：无 JavaScript、减少动态效果、第三/四屏自动播放和收尾结构；无页面异常或资源错误。');
  } finally {await browser.close();}
})().catch(e => {console.error(e);process.exitCode=1;});
