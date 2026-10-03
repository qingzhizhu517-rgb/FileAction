/* 手动真实模型 Agent 验收，会消耗额度；仅发送标注为合成的通知和背景。 */
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const {chromium}=require('playwright');
(async()=>{
  const browser=await chromium.launch({channel:'chrome',headless:true});
  const page=await browser.newPage({viewport:{width:1440,height:1050},acceptDownloads:true});
  page.setDefaultTimeout(115000);
  const report={date:new Date().toISOString(),synthetic_data:true,real_model:true,model:'',steps:[]};
  const testName=`合成工作区验收-${Date.now()}.txt`;let projectId=null;
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  const ready=()=>page.waitForFunction(()=>!document.body.classList.contains('busy'));
  const run=async(name,fn)=>{const start=Date.now();await fn();report.steps.push({name,passed:true,seconds:(Date.now()-start)/1000});console.log('PASS '+name);};
  try {
    await page.goto(process.env.FILEACTION_LIVE_URL || 'http://127.0.0.1:8792/');
    const status=await page.evaluate(async()=>{
      const headers={'X-FileAction-Token':document.querySelector('meta[name="fileaction-token"]').content};
      const [status,memory]=await Promise.all([fetch('/api/status',{headers}).then(r=>r.json()),fetch('/api/memory',{headers}).then(r=>r.json())]);
      return {configured:status.configured,model:status.model,memoryCount:memory.entries.length};
    });
    assert.equal(status.memoryCount,0,'保护真实个人背景，本验收仅允许空记忆环境');assert.equal(status.configured,true);report.model=status.model;
    await run('上传后自动进入 Agent，无个人资料也先给真实总结',async()=>{
      await page.locator('#upload-consent').check();await page.locator('#persist-consent').uncheck();
      await page.locator('#upload').setInputFiles({name:testName,mimeType:'text/plain',buffer:Buffer.from('合成验收通知：学校和项目均虚构。\n星河大学项目创新奖学金申请通知\n面向全日制在校本科生；教师可转发通知提醒学生。\n申请人须提交项目成果说明、成绩单和个人申请陈述。\n本学年不得重复获得同类资助。\n申请截止时间：2026年10月20日17:00（北京时间）。\n报名链接：https://example.com/synthetic-apply（合成示例链接）\n材料须本人核对，准备材料不代表资格通过。')});
      await page.locator('.assistant-message').first().waitFor();await ready();
      assert.equal(await page.locator('#background').count(),0);assert.equal(await page.locator('.steps').count(),0);
      projectId=await page.evaluate(async()=>{const headers={'X-FileAction-Token':document.querySelector('meta[name="fileaction-token"]').content};const got=await fetch('/api/workspaces',{headers}).then(r=>r.json());return got.workspaces[0].id;});
      assert.equal(await page.locator('#summary-highlights a').getAttribute('href'),'https://example.com/synthetic-apply');
      report.summary=await page.locator('.file-summary').textContent();assert.ok(report.summary.length>20);
      report.positioning=await page.locator('.positioning').count()?await page.locator('.positioning').textContent():'';
      assert.ok(await page.locator('.agent-question').count()<=2);
      assert.equal(await page.locator('#action-section').isVisible(),false);assert.equal(await page.locator('#memory-count').textContent(),'0');
      await page.locator('.insight-details').first().locator('summary').click();await page.locator('.evidence').first().click();
      assert.ok(await page.locator('.source-line.highlight').count());
      await page.screenshot({path:'var/live-workspace-first-summary.png',fullPage:true});
    });
    await run('真实连续对话，用户纠正定位后再推进',async()=>{
      await page.locator('#chat-input').fill('合成验收背景：我是老师，想把这份通知转发给学生。请从我的角色指出需要提醒的关键事项，并给出可选的通知转发稿入口。');
      await page.locator('#chat-send').click();await page.locator('.assistant-message').nth(1).waitFor();await ready();
      report.followup=await page.locator('.assistant-message').last().textContent();assert.match(report.followup,/老师|教师|转发/);
      assert.equal(await page.locator('#memory-count').textContent(),'0');
      assert.match(await page.locator('#file-knowledge').textContent(),/老师|教师/);
    });
    await run('编辑文件沉淀后真实模型读取最新身份',async()=>{
      await page.locator('#knowledge-add').click();await page.locator('#knowledge-field').selectOption('role');await page.locator('#knowledge-value').fill('合成验收修正：我是负责资助事务的行政人员，需要整理学生咨询回复。');
      await page.locator('#knowledge-form button[type=submit]').click();await page.locator('#knowledge-dialog').waitFor({state:'hidden'});
      assert.equal(await page.locator('.assistant-message').count(),2);
      await page.locator('#chat-input').fill('请按文件沉淀中我修改的最新身份，重新解释这份通知；给出可选的通知转发稿入口。');await page.locator('#chat-send').click();await page.locator('.assistant-message').nth(2).waitFor();await ready();
      report.edited_role_response=await page.locator('.assistant-message').last().textContent();assert.match(report.edited_role_response,/行政|资助事务/);assert.equal(await page.locator('#memory-count').textContent(),'0');
    });
    await run('按对话目标确认生成真实转发稿',async()=>{
      const choices=page.locator('.assistant-message').last().locator('.action-choice');
      assert.ok(await choices.count()>0,'真实回复应给出用户所请求的可选产物入口');await choices.first().click();
      await page.locator('#goal').fill('给学生转发这份合成通知的简短提醒稿。只根据通知列出材料、截止时间及需核实条件，不编造我的身份或学校政策。');
      await page.locator('#action-confirm').check();await page.locator('#generate').click();
      await page.locator('#draft-section').waitFor({state:'visible'});await ready();
      report.draft_title=await page.locator('#draft-title').textContent();report.draft_characters=(await page.locator('#draft').inputValue()).length;
      assert.ok(report.draft_characters>50);
    });
    await run('编辑导出并直接结束，不强制沉淀',async()=>{
      await page.locator('#draft').fill((await page.locator('#draft').inputValue())+'\n\n合成验收编辑补充：请同学自行核实是否重复获得资助。');
      const downloadPromise=page.waitForEvent('download');await page.locator('#export-draft').click();
      const download=await downloadPromise;await download.saveAs('var/live-workspace-synthetic-draft.md');
      assert.match(await fs.readFile('var/live-workspace-synthetic-draft.md','utf8'),/合成验收编辑补充/);
      await page.screenshot({path:'var/live-workspace-preview.png',fullPage:true});assert.deepEqual(errors,[]);
      await page.locator('#finish').click();await page.locator('#welcome').waitFor({state:'visible'});
    });
    await run('关闭后重开保留对话与草稿，新会话共享沉淀',async()=>{
      await page.locator('#recent-workspaces .workspace-open').filter({hasText:testName}).click();await ready();
      assert.equal(await page.locator('.assistant-message').count(),3);assert.match(await page.locator('#draft').inputValue(),/合成验收编辑补充/);
      await page.locator('.new-thread').click();await ready();assert.equal(await page.locator('.assistant-message').count(),0);assert.match(await page.locator('#file-knowledge').textContent(),/行政人员/);
      await page.locator('#send-consent').check();await page.locator('#analyze').click();await page.locator('.assistant-message').waitFor();await ready();
      report.new_thread_response=await page.locator('.assistant-message').textContent();assert.match(report.new_thread_response,/行政|资助事务/);
      await page.reload();await page.locator('#workspace').waitFor({state:'visible'});await ready();assert.equal(await page.locator('#thread-tabs .thread-tab').count(),2);
      assert.match(await page.locator('#cos-file-state').textContent(),/临时/);
    });
    await fs.writeFile('var/live-workspace-verification.json',JSON.stringify(report,null,2));
    console.log(JSON.stringify({model:report.model,passed:report.steps.length,draft_characters:report.draft_characters}));
  } catch(error) {
    report.error=error.message;await fs.writeFile('var/live-workspace-failure.json',JSON.stringify(report,null,2));throw error;
  } finally {
    if(projectId)await page.evaluate(async id=>{const headers={'Content-Type':'application/json','X-FileAction-Token':document.querySelector('meta[name="fileaction-token"]').content};await fetch('/api/workspace/delete',{method:'POST',headers,body:JSON.stringify({file_id:id,consent:true})});},projectId).catch(()=>{});
    await browser.close();
  }
})().catch(e=>{console.error(e.message);process.exit(1)});
