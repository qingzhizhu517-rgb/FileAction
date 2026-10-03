/* 文件速览行为验收：仅使用合成文件、隔离 HTTP 模型替身。 */
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const {chromium}=require('playwright');
(async()=>{
 const browser=await chromium.launch({channel:'chrome',headless:true});
 const page=await browser.newPage({viewport:{width:1440,height:1000}});page.setDefaultTimeout(12000);
 const checks=[];
 const check=async(name,fn)=>{try{await fn();checks.push({name,passed:true});}catch(e){checks.push({name,passed:false,error:e.message.split('\n')[0]});}};
 let uploadNumber=0;
 async function upload(text){
  const name=`合成四六级速览-${++uploadNumber}.txt`;
  await page.locator('#upload-consent').check();await page.locator('#persist-consent').uncheck();
  await page.locator('#upload').setInputFiles({name,mimeType:'text/plain',buffer:Buffer.from(text+"\n合成样例编号："+Date.now())});
  await page.waitForFunction(name=>document.querySelector('.workspace-heading h1')?.textContent===name,name);
  await page.locator('.assistant-message').first().waitFor();await page.waitForFunction(()=>!document.body.classList.contains('busy'));
 }
 try{
  await page.goto('http://127.0.0.1:8790/');
  const paragraph='报名方式：登录报名网站（https://example.com/apply），具体操作流程详见链接（https://example.com/guide）。报名时间截止后无法报名，不接受补报名。';
  await upload('合成通知\n'+paragraph+'\n'+paragraph+'\n附件下载：https://example.com/materials\n报名截止：2099年11月30日17:00（北京时间）。\n报名截止：2099年11月30日17:00（北京时间）。\n缴费截止：2099年11月30日17:00（北京时间）。\n笔试时间：2099年12月12日。\n申请人须提交项目成果说明；成绩单；个人陈述。\n申请人须提交项目成果说明；成绩单；个人陈述。');
  await check('同类合并成三个区域，没有整段误识别的截止卡片',async()=>{
   assert.equal(await page.locator('#summary-highlights > .quicklook-group').count(),3);
   const values=await page.locator('.highlight-value').allTextContents();
   assert.ok(values.length===3);assert.ok(values.every(v=>v.length<35));
   assert.doesNotMatch(await page.locator('#summary-highlights').textContent(),/报名时间截止后无法报名/);
   assert.equal(await page.locator('.summary-highlight.deadline').count(),2);
  });
  await check('报名、操作指南和附件各一条，重复日期与材料去重',async()=>{
   const links=page.locator('#summary-highlights a');assert.equal(await links.count(),3);
   assert.match(await links.nth(0).textContent(),/报名入口/);
   assert.match(await links.nth(1).textContent(),/操作指南/);
   assert.match(await links.nth(2).textContent(),/附件/);
   assert.equal(await page.locator('.requirement-list li').count(),3);
   assert.match(await page.locator('#summary-highlights').textContent(),/报名截止/);
   assert.match(await page.locator('#summary-highlights').textContent(),/缴费截止/);
   assert.equal(await page.locator('.countdown-value').count(),2);
  });
  await check('原文按需打开，速览紧凑且窄屏不溢出',async()=>{
   await page.locator('.summary-highlight.link .highlight-source').first().click();
   assert.match(await page.locator('#source-preview').textContent(),/报名时间截止后无法报名/);
   await page.locator('[data-close="source-dialog"]').click();
   await page.locator('#file-quicklook').scrollIntoViewIfNeeded();
   const bounds=await page.locator('#file-quicklook').boundingBox();await page.screenshot({path:'/tmp/fileaction-clean-quicklook.png'});assert.ok(bounds.height<460,`速览过高 ${bounds.height}`);
   await page.screenshot({path:'/tmp/fileaction-clean-quicklook.png'});
   for(const width of [768,390,320]){await page.setViewportSize({width,height:844});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);}
  });
  await page.setViewportSize({width:1440,height:1000});await page.locator('#finish').click();
  await upload('合成日期边界通知\n报名时间截止后将无法报名。\n报名截止：10月20日。\n申请截止：2099年2月30日。\n报名链接：https://example.com/apply?q=one\n报名链接：https://example.com/apply?q=two\n报名链接：https://user:secret@example.com/private\n操作流程详见链接：https://example.com/guide');
  await check('无日期不生成截止卡，缺年份不计时，不合并不同查询链接',async()=>{
   assert.equal(await page.locator('.summary-highlight.deadline').count(),1,await page.locator('#summary-highlights').textContent());
   assert.equal(await page.locator('.highlight-value').textContent(),'10月20日');
   assert.equal(await page.locator('.countdown-value').count(),0);
   assert.match(await page.locator('.date-note').textContent(),/核对/);
   assert.equal(await page.locator('#summary-highlights a').count(),3,await page.locator('#summary-highlights').textContent());
   assert.equal(await page.locator('#summary-highlights a[href*="secret"]').count(),0);
  });
  await page.locator('#finish').click();
  await upload('合成多链接通知\n'+Array.from({length:11},(_,i)=>`参考资料：https://example.com/reference-${i}`).join('\n')+'\n提交截止：2099年12月31日（北京时间）。');
  await check('超过三条按需展开，旧缓存截断后仍显示真实截止日期',async()=>{
   const more=page.locator('.quicklook-links .quicklook-more');
   assert.equal(await more.getAttribute('open'),null);
   assert.equal(await page.locator('.quicklook-links a:visible').count(),3);
   assert.equal(await page.locator('.highlight-value').textContent(),'2099年12月31日');
   assert.match(await page.locator('.countdown-value').textContent(),/约.*天/);
   await more.locator('summary').click();assert.equal(await page.locator('.quicklook-links a:visible').count(),11);
   await more.locator('.highlight-source').last().click();
   assert.match(await page.locator('#source-preview .is-target').textContent(),/reference-10/);
   await page.locator('[data-close="source-dialog"]').click();
  });
  console.log(JSON.stringify(checks,null,2));await fs.writeFile('/tmp/fileaction-quicklook-verification.json',JSON.stringify(checks,null,2));
  if(checks.some(c=>!c.passed))process.exitCode=1;
 }finally{await browser.close();}
})().catch(e=>{console.error(e.stack);process.exit(1);});
