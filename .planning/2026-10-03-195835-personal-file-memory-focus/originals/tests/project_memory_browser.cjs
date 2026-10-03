/* 项目沉淀侧栏验收：独立合成 HTTP 模型、隔离档案，非真实 LLM。 */
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch({ channel:'chrome', headless:true });
  const page = await browser.newPage({ viewport:{width:1440,height:1050} });
  page.setDefaultTimeout(10000);
  const checks=[];
  const ready=()=>page.waitForFunction(()=>!document.body.classList.contains('busy'));
  const check=async(name,fn)=>{try{await fn();checks.push({name,passed:true});}catch(e){checks.push({name,passed:false,error:e.message.split('\n')[0]});}};
  const stamp=Date.now(), nameA=`合成项目甲-${stamp}.txt`,nameB=`合成项目乙-${stamp}.txt`;
  const upload=async(name)=>{
    await page.locator('#upload-consent').check();await page.locator('#persist-consent').uncheck();
    await page.locator('#upload').setInputFiles({name,mimeType:'text/plain',buffer:Buffer.from(`合成项目通知 ${name}：申请人须提交项目成果说明、成绩单。`)});
    await page.locator('.assistant-message').waitFor();await ready();
  };
  const addNote=async(value)=>{
    await page.locator('#knowledge-add').click();await page.locator('#knowledge-field').selectOption('notes');
    await page.locator('#knowledge-value').fill(value);await page.locator('#knowledge-form button[type=submit]').click();
    await page.locator('#knowledge-dialog').waitFor({state:'hidden'});await ready();
  };
  try{
    await page.goto('http://127.0.0.1:8790/');await upload(nameA);
    await check('右侧首个区域为当前项目沉淀，档案依据默认折叠',async()=>{
      assert.equal(await page.locator('.source-panel > :first-child').getAttribute('class'),'knowledge-panel');
      assert.equal(await page.locator('.knowledge-panel h2').textContent(),'项目沉淀');
      assert.equal(await page.locator('#project-memory-file').textContent(),nameA);
      assert.equal(await page.locator('#profile-context').count(),1);
      assert.equal(await page.locator('#profile-context').evaluate(e=>e.open),false);
    });
    await addNote('合成项目甲专属：本项目先准备作品说明');
    await page.locator('#finish').click();await page.locator('#welcome').waitFor({state:'visible'});
    await upload(nameB);await addNote('合成项目乙专属：本项目先核对材料清单');
    await check('不同项目卡片隔离，项目沉淀仍自动归入全局档案',async()=>{
      assert.match(await page.locator('#file-knowledge').textContent(),/合成项目乙专属/);
      assert.doesNotMatch(await page.locator('#file-knowledge').textContent(),/合成项目甲专属/);
      const contents=await page.evaluate(async()=>{
        const headers={'X-FileAction-Token':document.querySelector('meta[name="fileaction-token"]').content};
        return (await fetch('/api/memory',{headers}).then(r=>r.json())).entries.map(e=>e.content).join('\n');
      });
      assert.match(contents,/合成项目甲专属/);assert.match(contents,/合成项目乙专属/);
    });
    await check('档案依据按需展开，切换项目重新折叠并展示对应卡片',async()=>{
      assert.equal(await page.locator('#profile-context').count(),1);
      await page.locator('#profile-context > summary').click();
      assert.equal(await page.locator('#profile-context').evaluate(e=>e.open),true);
      await page.locator('#workspace-tabs .file-tab').filter({hasText:nameA}).click();await ready();
      assert.match(await page.locator('#file-knowledge').textContent(),/合成项目甲专属/);
      assert.doesNotMatch(await page.locator('#file-knowledge').textContent(),/合成项目乙专属/);
      assert.equal(await page.locator('#profile-context').evaluate(e=>e.open),false);
      assert.equal(await page.locator('#project-memory-file').textContent(),nameA);
    });
    await check('项目卡片修改、同文件多会话共享和刷新恢复',async()=>{
      await page.locator('#workspace-tabs .file-tab').filter({hasText:nameA}).click();await ready();
      await page.locator('#file-knowledge .knowledge-edit').click();
      await page.locator('#knowledge-value').fill('合成项目甲修正：先完善个人作品说明');
      await page.locator('#knowledge-form button[type=submit]').click();await page.locator('#knowledge-dialog').waitFor({state:'hidden'});await ready();
      await page.locator('.new-thread').click();await ready();
      assert.match(await page.locator('#file-knowledge').textContent(),/合成项目甲修正/);
      await page.reload();await page.locator('#workspace').waitFor({state:'visible'});await ready();
      assert.match(await page.locator('#file-knowledge').textContent(),/合成项目甲修正/);
      assert.equal(await page.locator('#profile-context').evaluate(e=>e.open),false);
    });
    await check('手机宽度展示当前项目，无横向溢出，补充可取消',async()=>{
      for(const width of [768,390,320]){
        await page.setViewportSize({width,height:844});
        assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
        await page.locator('#knowledge-add').click();await page.locator('[data-close="knowledge-dialog"]').click();
        assert.match(await page.locator('#file-knowledge').textContent(),/合成项目甲修正/);
      }
      await page.setViewportSize({width:1440,height:1050});
      await page.screenshot({path:'/tmp/fileaction-project-memory-desktop.png',fullPage:true});
    });
    console.log(JSON.stringify(checks,null,2));await fs.writeFile('/tmp/fileaction-project-memory-verification.json',JSON.stringify(checks,null,2));
    if(checks.some(c=>!c.passed))process.exitCode=1;
  }finally{await browser.close();}
})().catch(e=>{console.error(e.stack);process.exit(1);});
