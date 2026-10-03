/* UI 精简验收：合成文件、合成 HTTP 模型与 COS 替身；不使用用户资料。 */
const assert=require('node:assert/strict'),fs=require('node:fs/promises');
const {chromium}=require('playwright');
(async()=>{
 const browser=await chromium.launch({channel:'chrome',headless:true});
 const page=await browser.newPage({viewport:{width:1440,height:1000},acceptDownloads:true});page.setDefaultTimeout(10000);
 const checks=[],errors=[];page.on('pageerror',e=>errors.push(e.message));
 const ready=()=>page.waitForFunction(()=>!document.body.classList.contains('busy'));
 const check=async(name,fn)=>{try{await fn();checks.push({name,passed:true});}catch(e){checks.push({name,passed:false,error:e.message.split('\n')[0]});}};
 const name=`合成2026年全国大学英语考试报名通知-${Date.now()}.txt`;
 async function upload(filename,body){
  await page.locator('#upload-consent').check();await page.locator('#persist-consent').uncheck();
  await page.locator('#upload').setInputFiles({name:filename,mimeType:'text/plain',buffer:Buffer.from(body+"\n合成编号："+Date.now())});
  await page.waitForFunction(name=>document.querySelector('#doc-name')?.textContent===name,filename);
  await page.locator('.assistant-message').first().waitFor();await ready();
 }
 try{
  await page.goto('http://127.0.0.1:8790/');
  await page.evaluate(async()=>{
   const headers={'Content-Type':'application/json','X-FileAction-Token':document.querySelector('meta[name="fileaction-token"]').content};
   const status=await fetch('/api/status',{headers}).then(r=>r.json());if(!status.model.includes('合成HTTP测试替身'))throw new Error('只能清理独立合成测试服务');
   const workspaces=await fetch('/api/workspaces',{headers}).then(r=>r.json());for(const w of workspaces.workspaces)await fetch('/api/workspace/delete',{method:'POST',headers,body:JSON.stringify({file_id:w.id,consent:true})});
   const memory=await fetch('/api/memory',{headers}).then(r=>r.json());for(const m of memory.entries)await fetch('/api/memory',{method:'POST',headers,body:JSON.stringify({action:'remove',target:m.target,entry_id:m.id,consent:true})});
   localStorage.clear();
  });await page.reload();
  await page.screenshot({path:'/tmp/fileaction-ui-home.png'});
  await upload(name,'合成通知\n报名时间：2099年9月18日10:00至2099年9月23日17:00（北京时间）。\n缴费时间：2099年9月18日10:00至2099年9月24日17:00（北京时间）。\n笔试时间：2099年12月12日。\n报名入口：https://example.com/apply\n操作指南：https://example.com/guide\n申请人须提交项目成果说明；成绩单；个人陈述。');
  await page.waitForTimeout(300);await page.evaluate(()=>scrollTo({top:0,behavior:'instant'}));await page.screenshot({path:'/tmp/fileaction-ui-workspace.png'});
  await check('保留左侧文件、中间对话、右侧沉淀，单文件不重复显示标签栏',async()=>{
   const left=await page.locator('.sidebar').boundingBox(),center=await page.locator('.work-column').boundingBox(),right=await page.locator('.source-panel').boundingBox();
   assert.ok(left.x+left.width<=center.x);assert.ok(center.x+center.width<=right.x);
   assert.ok(center.width>right.width);assert.equal(await page.locator('#workspace-tabs').isVisible(),false);
   const summary=await page.locator('#file-quicklook').boundingBox();assert.ok(summary.height<330,`速览高度 ${summary.height}`);
  });
  await check('阅读视角默认折叠，仍能展开纠正；回答入口与原文保留',async()=>{
   assert.equal(await page.locator('.positioning .clarification-trigger').isVisible(),false);
   await page.locator('.positioning > summary').click();await page.locator('.positioning .clarification-trigger').click();
   await page.locator('#clarification-dialog').waitFor({state:'visible'});await page.locator('#clarification-skip').click();
   await page.locator('.agent-question').first().click();await page.locator('#clarification-dialog').waitFor({state:'visible'});await page.locator('#clarification-skip').click();
   await page.locator('.highlight-source').first().click();await page.locator('#source-dialog').waitFor({state:'visible'});
   assert.match(await page.locator('#source-preview .is-target').textContent(),/2099年9月/);await page.locator('[data-close="source-dialog"]').click();
   assert.equal(await page.locator('#source-details').evaluate(e=>e.open),false,'查看出处后侧栏保持折叠');
  });
  await check('最新一轮保留行动按钮，沉淀编辑、导出和发送范围仍可操作',async()=>{
   await page.locator('#chat-input').fill('合成自述：我是老师，想给学生转发通知');await page.locator('#chat-send').click();
   await page.locator('.assistant-message').nth(1).waitFor();await ready();
   assert.equal(await page.locator('.turn-options:visible').count(),1);
   assert.ok(await page.locator('.action-choice:visible').count()>0);assert.equal(await page.locator('.skip-questions:visible').count(),1);
   assert.match(await page.locator('#file-knowledge').textContent(),/老师/);
   await page.locator('.knowledge-edit').first().click();await page.locator('#knowledge-dialog').waitFor({state:'visible'});
   await page.locator('[data-close="knowledge-dialog"]').click();
   assert.equal(await page.locator('#composer-scope').evaluate(e=>e.open),false);
   await page.locator('#composer-scope > summary').click();for(const term of [/文件/,/档案/,/模型/])assert.match(await page.locator('#composer-scope').textContent(),term);
   const download=page.waitForEvent('download');await page.locator('#export-analysis').click();await download;
   assert.equal(await page.locator('#profile-context').evaluate(e=>e.open),false);
   await page.locator('.storage-details > summary').click();assert.equal(await page.locator('#store-original').isVisible(),true);
   await page.locator('.storage-details > summary').click();
  });
  await check('多文件标签、多会话和移动端布局完整保留',async()=>{
   await page.locator('#finish').click();await upload('合成第二份文件.txt','合成第二份通知：申请人须提交项目成果说明。');
   assert.equal(await page.locator('#workspace-tabs').isVisible(),true);assert.equal(await page.locator('.file-tab').count(),2);
   await page.locator('.sidebar-file').filter({hasText:name}).click();await ready();
   await page.locator('.new-thread').click();await ready();assert.equal(await page.locator('.thread-tab').count(),2);
   assert.match(await page.locator('#file-knowledge').textContent(),/老师/);
   await page.locator('.thread-tab').first().click();await ready();
   for(const width of [1440,1024,768,390,320]){
    await page.setViewportSize({width,height:844});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
   }
   await page.setViewportSize({width:1440,height:1000});await page.locator('.personal-focus').first().scrollIntoViewIfNeeded();
   await page.screenshot({path:'/tmp/fileaction-ui-conversation.png'});
   await page.setViewportSize({width:390,height:844});await page.locator('.assistant-message').last().scrollIntoViewIfNeeded();
   await page.screenshot({path:'/tmp/fileaction-ui-mobile.png'});
   assert.deepEqual(errors,[]);
  });
  console.log(JSON.stringify(checks,null,2));await fs.writeFile('/tmp/fileaction-ui-verification.json',JSON.stringify(checks,null,2));
  if(checks.some(c=>!c.passed))process.exitCode=1;
 }finally{await browser.close();}
})().catch(e=>{console.error(e.stack);process.exit(1);});
