/* main 首页、账号界面与文件 Agent 对接：合成账号/文件/模型/COS，仅访问8792。 */
const assert=require('node:assert/strict'),fs=require('node:fs/promises');
const {chromium}=require('playwright');
(async()=>{
 const browser=await chromium.launch({channel:'chrome',headless:true});
 const context=await browser.newContext({viewport:{width:1440,height:1000},acceptDownloads:true});
 const page=await context.newPage();page.setDefaultTimeout(10000);
 const errors=[],checks=[];page.on('pageerror',e=>errors.push(e.message));
 const check=async(name,fn)=>{try{await fn();checks.push({name,passed:true});}catch(e){console.error(e.stack);await page.screenshot({path:'/tmp/fileaction-auth-failure.png'});console.error('页面状态',await page.evaluate(()=>({url:location.pathname,alert:document.querySelector('[role=alert]')?.textContent,title:document.querySelector('h2')?.textContent})));checks.push({name,passed:false,error:e.message.split('\n')[0]});}};
 const suffix=Date.now(),alice='synthetic_a_'+suffix,bob='synthetic_b_'+suffix,password='Synthetic-Pass-123!';
 const ready=()=>page.waitForFunction(()=>!document.body.classList.contains('busy'));
 async function login(username){await page.waitForURL('**/login');await page.getByRole('heading',{name:'欢迎回来',exact:true}).waitFor();await page.locator('[name=username]').fill(username);await page.locator('[name=password]').fill(password);await page.getByRole('button',{name:'登录',exact:true}).click();await page.waitForURL('**/files');await page.locator('#account-controls').waitFor();}
 async function signup(username){await page.getByRole('link',{name:'没有账号？创建账号'}).click();await page.locator('[name=display_name]').fill('合成账号 '+username.slice(0,11));await page.locator('[name=username]').fill(username);await page.locator('[name=password]').fill(password);await page.getByRole('button',{name:'注册并进入'}).click();await page.waitForURL('**/files');await page.locator('#account-controls').waitFor();}
 async function logout(){await page.locator('#account-logout').click();await page.waitForURL('**/login');await page.locator('[name=username]').waitFor();}
 try{
  await check('main 完整首页进入真实登录注册，成功后打开现有三栏文件 Agent',async()=>{
   await page.goto('http://127.0.0.1:8792/');await page.waitForURL('**/intro/');
   assert.equal(await page.locator('#closing').count(),1);await page.screenshot({path:'/tmp/fileaction-auth-home.png'});
   await page.getByRole('link',{name:'上传一份文件'}).click();await page.waitForURL('**/login');await page.locator('[name=username]').waitFor();
   await page.screenshot({path:'/tmp/fileaction-auth-login.png'});await signup(alice);
   assert.equal(await page.locator('.sidebar').isVisible(),true);
   assert.match(await page.locator('#account-name').textContent(),/合成账号/);
   assert.equal(await page.locator('#memory-count').textContent(),'0');
  });
  await check('文件上传、真实HTTP增量、本人沉淀编辑、引用核对和导出继续可用',async()=>{
   await page.locator('#upload-consent').check();await page.locator('#persist-consent').check();
   await page.locator('#upload').setInputFiles({name:`合成账号隔离通知-${suffix}.txt`,mimeType:'text/plain',buffer:Buffer.from('合成通知：申请人须提交项目成果说明。\n报名时间：2099年9月18日10:00至2099年9月23日17:00（北京时间）。\n报名入口：https://example.com/apply\n合成编号：'+suffix)});
   await page.locator('.stream-preview').waitFor();await page.locator('.assistant-message').waitFor();await ready();
   await page.locator('#chat-input').fill('合成自述：我是老师，想给学生转发通知');await page.locator('#chat-send').click();await page.locator('.assistant-message').nth(1).waitFor();await ready();
   assert.match(await page.locator('#file-knowledge').textContent(),/老师/);
   await page.locator('.knowledge-edit').first().click();await page.locator('#knowledge-value').fill('合成本人为行政人员，负责学生事务');await page.locator('#knowledge-form button[type=submit]').click();await page.locator('#knowledge-dialog').waitFor({state:'hidden'});
   assert.match(await page.locator('#file-knowledge').textContent(),/行政人员/);
   await page.locator('#chat-input').fill('请按修改后的沉淀继续解读');await page.locator('#chat-send').click();await page.locator('.assistant-message').nth(2).waitFor();await ready();
   assert.match(await page.locator('.assistant-message').last().textContent(),/行政人员/);
   await page.locator('.highlight-source').first().click();await page.locator('#source-dialog').waitFor();assert.match(await page.locator('#source-preview .is-target').textContent(),/2099/);await page.locator('[data-close=source-dialog]').click();
   await Promise.all([page.waitForEvent('download'),page.locator('#export-analysis').click()]);
   assert.match(await page.locator('#storage-summary').textContent(),/COS 已保存/);
   await page.screenshot({path:'/tmp/fileaction-auth-workspace.png'});
  });
  await check('退出确实撤销会话，第二账号看不到前一账号文件和档案',async()=>{
   await logout();
   const status=await page.evaluate(async()=>fetch('/api/status').then(r=>r.status));assert.equal(status,401);
   await page.goto('http://127.0.0.1:8792/files');await page.waitForURL('**/login');
   await signup(bob);assert.equal(await page.locator('#memory-count').textContent(),'0');assert.equal(await page.locator('.sidebar-file').count(),0);
   await logout();await login(alice);await ready();
   assert.equal(await page.locator('.sidebar-file').count(),1);assert.match(await page.locator('#file-knowledge').textContent(),/行政人员/);
   await page.locator('.new-thread').click();await ready();assert.match(await page.locator('#file-knowledge').textContent(),/行政人员/);
  });
  await check('错误密码保持在登录页，重复注册报错，手机端无水平溢出',async()=>{
   await logout();await page.locator('[name=username]').fill(alice);await page.locator('[name=password]').fill('Wrong-Pass-123!');await page.getByRole('button',{name:'登录',exact:true}).click();await page.getByRole('alert').waitFor();assert.match(await page.getByRole('alert').textContent(),/账号或密码/);
   await page.getByRole('link',{name:'没有账号？创建账号'}).click();await page.locator('[name=display_name]').fill('合成重复账号');await page.locator('[name=username]').fill(alice);await page.locator('[name=password]').fill(password);await page.getByRole('button',{name:'注册并进入'}).click();await page.getByRole('alert').waitFor();assert.match(await page.getByRole('alert').textContent(),/已存在/);
   await page.setViewportSize({width:390,height:844});const back=await page.locator('.entry-auth-back').boundingBox(),brand=await page.locator('.auth-story>.brand').boundingBox();assert.ok(back.y+back.height<=brand.y,'手机返回首页与品牌不能重叠');assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);await page.screenshot({path:'/tmp/fileaction-auth-mobile.png'});
   await page.getByRole('link',{name:'已有账号，返回登录'}).click();await login(alice);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);assert.deepEqual(errors,[]);
  });
  console.log(JSON.stringify(checks,null,2));await fs.writeFile('/tmp/fileaction-auth-verification.json',JSON.stringify(checks,null,2));if(checks.some(c=>!c.passed))process.exitCode=1;
 }finally{await browser.close();}
})().catch(e=>{console.error(e.stack);process.exit(1);});
