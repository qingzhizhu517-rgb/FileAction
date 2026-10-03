/* 结构化总结验收：隔离合成 HTTP 模型；不代表真实 LLM 或 COS。 */
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const {chromium}=require('playwright');
(async()=>{
 const browser=await chromium.launch({channel:'chrome',headless:true});
 const page=await browser.newPage({viewport:{width:1440,height:1000}});page.setDefaultTimeout(10000);
 const checks=[];const ready=()=>page.waitForFunction(()=>!document.body.classList.contains('busy'));
 const check=async(name,fn)=>{try{await fn();checks.push({name,passed:true});}catch(e){checks.push({name,passed:false,error:e.message.split('\n')[0]});}};
 const upload=async(body)=>{
   await page.locator('#upload-consent').check();await page.locator('#persist-consent').uncheck();
   await page.locator('#upload').setInputFiles({name:`合成速览-${Date.now()}.txt`,mimeType:'text/plain',buffer:Buffer.from(body+'\n合成测试编号：'+Date.now())});
   await page.locator('.assistant-message').first().waitFor();await ready();
 };
 try{
  await page.goto('http://127.0.0.1:8790/');
  await upload('合成速览通知\n报名截止：2099年11月30日17:00（北京时间）。截止前请自行核对申请材料。\n活动日期：2099年12月5日。\n报名链接：https://example.com/synthetic-summary\n申请人须提交项目成果说明；成绩单；个人陈述。');
  await check('日期为独立大字，倒计时单列，保留原文上下文',async()=>{
   assert.equal(await page.locator('#file-quicklook h2').textContent(),'文件速览');
   const date=page.locator('.summary-highlight.deadline');
   assert.equal(await date.locator('.highlight-value').textContent(),'2099年11月30日17:00');
   assert.match(await date.locator('.countdown-label').textContent(),/倒计时/);
   assert.match(await date.locator('.countdown-value').textContent(),/天.*小时.*分/);
   await date.locator('.fact-context > summary').click();
   assert.match(await date.locator('.fact-context').textContent(),/截止前请自行核对/);
   await date.locator('.highlight-source').click();await page.locator('#source-dialog').waitFor({state:'visible'});
   await page.locator('[data-close="source-dialog"]').click();
  });
  await check('报名入口独立按钮，材料拆成条目，记忆自动保存',async()=>{
   const link=page.locator('.summary-highlight.link a');
   assert.match(await link.textContent(),/报名入口/);assert.equal(await link.getAttribute('href'),'https://example.com/synthetic-summary');
   assert.equal(await page.locator('.summary-highlight.requirement li').count(),3);
   const app=await fs.readFile('src/web/app.js','utf8');
   const compose=new Function(app.slice(app.indexOf('const READING_MARKER='),app.indexOf('\nfunction el('))+';return readingRequest;')();
   assert.ok(compose('字'.repeat(3500)).length<=4000);
   await page.locator('#chat-input').fill('合成自述：我是老师，想给学生转发通知');await page.locator('#chat-send').click();
   await page.locator('.assistant-message').nth(1).waitFor();await ready();
   assert.match(await page.locator('#file-knowledge').textContent(),/老师/);
   assert.equal(await page.locator('.candidates').count(),0);assert.equal(await page.locator('#memory-consent').count(),0);
   assert.equal(await page.locator('#file-knowledge').getByText('加入用户档案',{exact:true}).count(),0);
  });
  await check('窄屏信息块不溢出，日期和入口保持独立',async()=>{
   for(const width of [768,390,320]){
    await page.setViewportSize({width,height:844});
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
   }
   await page.setViewportSize({width:1440,height:1000});
   await page.screenshot({path:'/tmp/fileaction-structured-summary.png',fullPage:true});
  });
  await page.locator('#finish').click();await page.locator('#welcome').waitFor({state:'visible'});
  await upload('合成不完整时间通知\n报名截止：10月20日，指定平台提交。\n申请人须提交项目成果说明。');
  await check('缺少年份时不编造倒计时或报名链接',async()=>{
   assert.equal(await page.locator('.summary-highlight.deadline .highlight-value').textContent(),'10月20日');
   assert.equal(await page.locator('.countdown-value').count(),0);
   assert.match(await page.locator('.summary-highlight.deadline .date-note').textContent(),/核对/);
   assert.equal(await page.locator('.summary-highlight.link').count(),0);
  });
  console.log(JSON.stringify(checks,null,2));await fs.writeFile('/tmp/fileaction-summary-verification.json',JSON.stringify(checks,null,2));
  if(checks.some(c=>!c.passed))process.exitCode=1;
 }finally{await browser.close();}
})().catch(e=>{console.error(e.stack);process.exit(1);});
