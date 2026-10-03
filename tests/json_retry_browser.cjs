/* JSON 格式纠正浏览器验收：合成故障注入和隔离合成 HTTP 模型，不是真实 LLM。 */
const assert=require('node:assert/strict'),fs=require('node:fs/promises');
const {chromium}=require('playwright');
(async()=>{
 const browser=await chromium.launch({channel:'chrome',headless:true});
 const page=await browser.newPage({viewport:{width:1440,height:1050}});page.setDefaultTimeout(10000);
 const checks=[],requests=[];let mode='recover',attempts=0,cancelStarted;
 const ready=()=>page.waitForFunction(()=>!document.body.classList.contains('busy'));
 const check=async(name,fn)=>{try{await fn();checks.push({name,passed:true});}catch(e){checks.push({name,passed:false,error:e.message.split('\n')[0]});}};
 page.on('request',r=>{if(r.url().endsWith('/api/chat'))requests.push(r.postDataJSON());});
 await page.route('**/api/chat',async route=>{
  attempts++;
  if(mode==='network'){await route.fulfill({status:502,contentType:'application/json',body:JSON.stringify({error:'模型流式请求失败（HTTP 429）。合成测试。'})});return;}
  if(attempts===1 || mode==='fail' || mode==='mixed'){
   const error=mode==='mixed' && attempts===2 ? '模型原文引用校验失败，未展示无依据结果。请重试。' : '模型流式数据或最终JSON格式不正确，未保存不完整结果。';
   await route.fulfill({contentType:'application/x-ndjson',body:JSON.stringify({type:'delta',field:'response',text:'合成未核验临时内容'})+'\n'+JSON.stringify({type:'error',error,status:502})+'\n'});return;
  }
  if(mode==='cancel')cancelStarted?.();
  await route.continue();
 });
 try{
  await page.goto('http://127.0.0.1:8790/');await page.locator('#upload-consent').check();await page.locator('#persist-consent').uncheck();
  await page.locator('#upload').setInputFiles({name:`合成格式纠正-${Date.now()}.txt`,mimeType:'text/plain',buffer:Buffer.from(`合成通知 ${Date.now()}\n申请人须提交项目成果说明和成绩单。`)});
  // 上传完成和 Agent 请求开始之间会短暂结束 busy，须等待对话的终态。
  await page.waitForFunction(()=>document.querySelector('.assistant-message') || (document.querySelector('.stream-failed') && !document.body.classList.contains('busy')));await ready();
  await check('格式失败自动纠正一次，同一问题不重复保存，旧临时文字清除',async()=>{
   assert.equal(attempts,2,'格式失败只应调用两次');assert.equal(await page.locator('.assistant-message').count(),1,'校正成功应保存一轮回复');
   assert.equal(await page.locator('.stream-failed').count(),0);assert.equal(await page.locator('.stream-preview').count(),0);
   assert.match(requests[1].message,/上次JSON格式校验失败/);
   assert.match(requests[1].message,/完整JSON|转义/);
   assert.equal(await page.locator('.user-message').count(),1);
   assert.doesNotMatch(await page.locator('#agent-thread').textContent(),/合成未核验临时内容/);
   const app=await fs.readFile('src/web/app.js','utf8');const compose=new Function(app.slice(app.indexOf('const READING_MARKER='),app.indexOf('\nfunction el('))+';return readingRequest;')();
   assert.ok(compose('字'.repeat(3500),'format').length<=4000);
  });
  await check('两次格式失败停止重试，无新回复或记忆，允许手动重试',async()=>{
   mode='fail';attempts=0;const memory=await page.locator('#memory-count').textContent();
   await page.locator('#chat-input').fill('合成格式失败边界');await page.locator('#chat-send').click();await ready();
   assert.equal(attempts,2);assert.equal(await page.locator('.assistant-message').count(),1);
   assert.equal(await page.locator('#memory-count').textContent(),memory);
   assert.match(await page.locator('.stream-failed .stream-status').last().textContent(),/自动纠正一次/);
   assert.equal(await page.locator('#retry-chat').isVisible(),true);
  });
  await check('格式修复后引用仍失败，整轮最多两次请求且不保存',async()=>{
   mode='mixed';attempts=0;const memory=await page.locator('#memory-count').textContent();
   await page.locator('#chat-input').fill('合成混合失败边界');await page.locator('#chat-send').click();await ready();
   assert.equal(attempts,2);assert.equal(await page.locator('.assistant-message').count(),1);
   assert.equal(await page.locator('#memory-count').textContent(),memory);
   assert.match(await page.locator('.stream-failed .stream-status').last().textContent(),/原文引用校验失败/);
  });
  await check('接口错误不自动重试，避免无关重复调用',async()=>{
   mode='network';attempts=0;await page.locator('#chat-input').fill('合成额度失败边界');await page.locator('#chat-send').click();await ready();
   assert.equal(attempts,1);assert.match(await page.locator('.stream-failed .stream-status').textContent(),/HTTP 429/);
   assert.equal(await page.locator('#notice').isVisible(),false);
  });
  await check('纠正过程中可以取消，迟到结果不生效，也不进行第三次请求',async()=>{
   mode='cancel';attempts=0;const memory=await page.locator('#memory-count').textContent();
   const correcting=new Promise(resolve=>{cancelStarted=resolve;});
   await page.locator('#chat-input').fill('延迟合成测试');await page.locator('#chat-send').click();
   let cancelTimer;
   try{await Promise.race([correcting,new Promise((_,reject)=>{cancelTimer=setTimeout(()=>reject(new Error('纠正请求未开始')),10000);})]);}finally{clearTimeout(cancelTimer);}
   await page.getByText('文启 · 正在纠正输出格式',{exact:true}).last().waitFor();await page.locator('#cancel').click({force:true});await ready();
   await page.waitForTimeout(3300);assert.equal(attempts,2,'取消纠正后不应有第三次请求');
   assert.equal(await page.locator('.assistant-message').count(),1,'取消纠正不能保存迟到回复');assert.equal(await page.locator('#memory-count').textContent(),memory,'取消纠正不能修改档案');
  });
  console.log(JSON.stringify(checks,null,2));await fs.writeFile('/tmp/fileaction-json-retry-verification.json',JSON.stringify(checks,null,2));
  if(checks.some(c=>!c.passed))process.exitCode=1;
 }finally{await browser.close();}
})().catch(e=>{console.error(e.stack);process.exit(1);});
