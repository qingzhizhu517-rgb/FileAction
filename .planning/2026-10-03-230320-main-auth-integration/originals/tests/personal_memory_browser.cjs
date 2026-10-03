/* 个人沉淀与重点验收：隔离合成模型，历史卡片由只读网络替身注入，不是用户资料。 */
const assert=require('node:assert/strict'),fs=require('node:fs/promises');
const {chromium}=require('playwright');
(async()=>{
 const browser=await chromium.launch({channel:'chrome',headless:true});
 const page=await browser.newPage({viewport:{width:1440,height:1000}});page.setDefaultTimeout(10000);
 const checks=[],requests=[];const ready=()=>page.waitForFunction(()=>!document.body.classList.contains('busy'));
 page.on('request',r=>{if(r.url().endsWith('/api/chat'))requests.push(r.postDataJSON());});
 const check=async(name,fn)=>{try{await fn();checks.push({name,passed:true});}catch(e){checks.push({name,passed:false,error:e.message.split('\n')[0]});}};
 try{
  await page.goto('http://127.0.0.1:8790/');await page.locator('#upload-consent').check();await page.locator('#persist-consent').uncheck();
  await page.locator('#upload').setInputFiles({name:`合成个人沉淀-${Date.now()}.txt`,mimeType:'text/plain',buffer:Buffer.from(`合成申请通知 ${Date.now()}\n申请人须提交项目成果说明、成绩单。`)});
  await page.locator('.assistant-message').waitFor();await ready();
  await page.route('**/api/workspace/open',async route=>{
   const response=await route.fetch(),doc=await response.json();
   doc.memory.push({id:'synthetic-legacy-document',kind:'document_fact',content:'合成文件规定必须交成绩单',target:'file'});
   doc.knowledge.entries=[
    {field:'background',kind:'user_fact',value:'合成用户自述：我做过小程序',quote:'我做过小程序',source:'来自合成用户对话'},
    {field:'notes',kind:'document_fact',value:'合成文件摘要：必须交成绩单',quote:'须提交',source_id:'L2',source:'来自原文'},
    {field:'conditions',kind:'document_fact',value:'合成文件面向本科生',quote:'申请人',source_id:'L2',source:'来自原文'},
    {field:'pending',kind:'unknown',value:'合成文件附件版本未知',quote:'申请人',source_id:'L2',source:'待核实'},
    {field:'role',kind:'global_ref',value:'合成文件规定必须交成绩单',quote:'合成文件规定必须交成绩单',source:'来自旧文档档案'},
   ];
   for(const m of doc.messages){if(m.role==='assistant')m.knowledge=doc.knowledge;}
   await route.fulfill({response,json:doc});
  });
  await page.reload();await page.locator('#workspace').waitFor({state:'visible'});await ready();
  await check('本文件沉淀仅展示本人信息，旧文件摘要和规则不混入',async()=>{
   assert.equal(await page.locator('.knowledge-panel h2').textContent(),'本文件沉淀');
   assert.match(await page.locator('#file-knowledge').textContent(),/我做过小程序/);
   assert.doesNotMatch(await page.locator('#file-knowledge').textContent(),/必须交成绩单|面向本科生|附件版本/);
   assert.equal(await page.locator('#file-knowledge .knowledge-card').count(),1);
  });
  await check('与你有关优先突出，首轮长说明默认折叠且仍可查看',async()=>{
   const first=page.locator('.assistant-message').first();
   assert.equal(await first.locator('.personal-focus h3').textContent(),'与你有关');
   assert.equal(await first.locator('.response-context').evaluate(e=>e.open),false);
   assert.equal(await first.locator('.response-context .message-text').isVisible(),false);
   assert.equal(await first.evaluate(e=>e.querySelector('.personal-focus').compareDocumentPosition(e.querySelector('.response-context'))&Node.DOCUMENT_POSITION_FOLLOWING),4);
   await first.locator('.response-context > summary').click();
   assert.equal(await first.locator('.response-context .message-text').isVisible(),true);
   await first.locator('.response-context > summary').click();
  });
  await check('个人卡片可修改并自动归档，新请求明确只整理本人信息',async()=>{
   await page.locator('#file-knowledge .knowledge-edit').click();await page.unroute('**/api/workspace/open');
   await page.locator('#knowledge-value').fill('合成用户修正：我做过两个小程序，希望优先了解作品方向');
   await page.locator('#knowledge-form button[type=submit]').click();await page.locator('#knowledge-dialog').waitFor({state:'hidden'});await ready();
   assert.match(await page.locator('#file-knowledge').textContent(),/两个小程序/);
   await page.locator('#chat-input').fill('合成补充：我是老师，想转发给学生');await page.locator('#chat-send').click();
   await page.locator('.assistant-message').nth(1).waitFor();await ready();
   assert.match(requests.at(-1).message,/file_knowledge_updates仅记我的自述或个人档案/);
   assert.match(await page.locator('#file-knowledge').textContent(),/老师/);
   assert.equal(await page.locator('.candidates').count(),0);
  });
  await check('个人重点、卡片和展开说明在手机上无溢出',async()=>{
   for(const width of [768,390,320]){
    await page.setViewportSize({width,height:844});
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
    await page.locator('.response-context > summary').first().click();
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
    await page.locator('.response-context > summary').first().click();
   }
   await page.setViewportSize({width:1440,height:1000});await page.locator('.personal-focus').first().scrollIntoViewIfNeeded();
   await page.screenshot({path:'/tmp/fileaction-personal-focus.png'});
  });
  console.log(JSON.stringify(checks,null,2));await fs.writeFile('/tmp/fileaction-personal-memory-verification.json',JSON.stringify(checks,null,2));
  if(checks.some(c=>!c.passed))process.exitCode=1;
 }finally{await browser.close();}
})().catch(e=>{console.error(e.stack);process.exit(1);});
