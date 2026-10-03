/* 合成账号、文件、模型和 COS 替身：检查统一品牌、隐藏云端入口及保留的开发开关。 */
const assert=require('node:assert/strict');
const {chromium}=require('playwright');
(async()=>{
 const browser=await chromium.launch({channel:'chrome',headless:true});
 const page=await browser.newPage({baseURL:'http://127.0.0.1:8792',viewport:{width:1440,height:1000},acceptDownloads:true});
 const checks=[],errors=[],uploads=[];page.setDefaultTimeout(12000);
 page.on('pageerror',e=>errors.push(e.message));
 page.on('request',r=>{if(r.url().endsWith('/api/documents'))uploads.push(r.postDataJSON());});
 const check=async(name,work)=>{try{await work();checks.push({name,passed:true});}catch(e){checks.push({name,passed:false,error:e.message});}};
 const ready=()=>page.waitForFunction(()=>!document.body.classList.contains('busy'));
 const svg=async path=>{
  if(path.startsWith('data:')){const cut=path.indexOf(',');return path.slice(0,cut).includes(';base64') ? Buffer.from(path.slice(cut+1),'base64').toString() : decodeURIComponent(path.slice(cut+1));}
  return page.request.get(path).then(r=>r.text());
 };
 try{
  await page.goto('http://127.0.0.1:8792/');
  const canonical=await page.request.get('/intro/wenqi-icon.svg').then(r=>r.text());
  await check('产品 logo 与宣传页 SVG 完全一致',async()=>{
   assert.equal(await page.request.get('/logo.svg').then(r=>r.text()),canonical);
  });
  await page.goto('http://127.0.0.1:8792/register');
  await page.locator('[name=display_name]').fill('合成品牌验收');
  await page.locator('[name=username]').fill('synthetic_brand_'+Date.now());
  await page.locator('[name=password]').fill('Synthetic-Pass-123!');
  await check('注册页品牌与浏览器图标均使用宣传页 logo',async()=>{
   const icon=await page.locator('link[rel=icon]').getAttribute('href');
   assert.equal(await svg(icon),canonical);
   const brand=await page.locator('.auth-story .brand img').getAttribute('src');
   assert.equal(await svg(brand),canonical);
  });
  await page.getByRole('button',{name:'注册并进入'}).click();await page.waitForURL('**/files');await ready();
  await check('首页不展示 COS 入口、设置和保存选项',async()=>{
   for(const id of ['files-open','cos-settings-open','persist-consent'])assert.equal(await page.locator('#'+id).isVisible(),false,id);
   assert.doesNotMatch(await page.locator('body').innerText(),/COS|腾讯云/);
  });
  await page.locator('#upload-consent').check();
  // 模拟旧页面残留勾选状态，关闭云端界面后也不能自动持久化新上传。
  await page.locator('#persist-consent').evaluate(input=>input.checked=true);
  await page.locator('#upload').setInputFiles({name:'合成品牌通知.txt',mimeType:'text/plain',buffer:Buffer.from('合成奖学金通知\n申请人须提交成果证明。\n截止时间为2099年10月20日。')});
  await page.locator('.assistant-message').waitFor();await ready();
  await check('上传、流式对话正常，默认不触发隐藏的云端保存',async()=>{
   assert.equal(uploads.at(-1).persist,false);
   assert.doesNotMatch(await page.locator('body').innerText(),/COS|腾讯云/);
   assert.equal(await page.locator('.storage-details').isVisible(),false);
   assert.equal(await page.locator('#retry-sync').isVisible(),false);
   assert.equal(await page.locator('.agent-avatar').evaluate(img=>img.tagName),'IMG');
   const avatar=await page.locator('.agent-avatar').getAttribute('src');
   assert.equal(await page.request.get(avatar).then(r=>r.text()),canonical);
  });
  await check('个人沉淀、多会话与导出保留，产物保存入口隐藏',async()=>{
   await page.locator('#chat-input').fill('合成自述：我是老师');await page.locator('#chat-send').click();
   await page.locator('.assistant-message').nth(1).waitFor();await ready();
   assert.match(await page.locator('#file-knowledge').textContent(),/老师/);
   await page.locator('.new-thread').click();await ready();
   assert.equal(await page.locator('#thread-tabs .thread-tab').count(),2);
   await page.locator('#thread-tabs .thread-tab').first().click();await ready();
   await Promise.all([page.waitForEvent('download'),page.locator('#export-analysis').click()]);
   await page.locator('.action-choice').last().click();await page.locator('#action-confirm').check();await page.locator('#generate').click();
   await page.locator('#draft-section').waitFor();await ready();
   assert.equal(await page.locator('#store-draft').isVisible(),false);
   await Promise.all([page.waitForEvent('download'),page.locator('#export-draft').click()]);
   await page.locator('#finish').click();await page.locator('#welcome').waitFor({state:'visible'});await ready();
   assert.doesNotMatch(await page.locator('body').innerText(),/COS|腾讯云/);
   for(const width of [1440,390]){
    await page.setViewportSize({width,height:1000});
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
   }
   await page.setViewportSize({width:1440,height:1000});
   await page.screenshot({path:'/tmp/fileaction-brand-home.png'});
  });
  await check('开发开关重新打开后，原 COS 功能仍可使用（合成替身）',async()=>{
   if(await page.locator('#workspace').isVisible()){await page.locator('#finish').click();await page.locator('#welcome').waitFor({state:'visible'});await ready();}
   await page.route('**/files',async route=>{
    const response=await route.fetch();
    const body=(await response.text()).replace('data-cloud-ui="disabled"','data-cloud-ui="enabled"');
    await route.fulfill({response,body});
   });
   await page.reload();await ready();
   assert.equal(await page.locator('#cos-settings-open').isVisible(),true);
   await page.locator('#persist-consent').check();await page.locator('#upload-consent').check();
   await page.locator('#upload').setInputFiles({name:'合成保留存储.txt',mimeType:'text/plain',buffer:Buffer.from('合成存储保留验收\n申请人须提交成果证明。')});
   await page.locator('.assistant-message').waitFor();await ready();
   assert.equal(uploads.at(-1).persist,true);
   assert.match(await page.locator('#cos-file-state').textContent(),/已同步/);
   assert.deepEqual(errors,[]);
  });
  console.log(JSON.stringify(checks,null,2));if(checks.some(c=>!c.passed))process.exitCode=1;
 }finally{await browser.close();}
})().catch(e=>{console.error(e.stack);process.exit(1);});
