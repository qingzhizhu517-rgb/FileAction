/* 合成 PDF + 合成 HTTP 模型：验证校验、出处、失败及重试界面，不代表真实 LLM。 */
const assert = require('node:assert/strict');
const {execFileSync} = require('node:child_process');
const {chromium} = require('playwright');

(async () => {
  const pdf = execFileSync('.venv/bin/python', ['-c', `
import io,sys
from pypdf import PdfWriter
from pypdf.generic import NameObject,DictionaryObject,DecodedStreamObject
w=PdfWriter();p=w.add_blank_page(width=300,height=300)
font=DictionaryObject({NameObject('/Type'):NameObject('/Font'),NameObject('/Subtype'):NameObject('/Type1'),NameObject('/BaseFont'):NameObject('/Helvetica')})
p[NameObject('/Resources')]=DictionaryObject({NameObject('/Font'):DictionaryObject({NameObject('/F1'):w._add_object(font)})})
s=DecodedStreamObject();s.set_data(b'BT /F1 12 Tf 10 200 Td (Complete 5 credits) Tj 0 -20 Td (before April 30.) Tj ET')
p[NameObject('/Contents')]=w._add_object(s)
b=io.BytesIO();w.write(b);sys.stdout.buffer.write(b.getvalue())
`]);
  const browser = await chromium.launch({channel:'chrome', headless:true});
  const page = await browser.newPage({viewport:{width:1440,height:1050}});
  const checks=[];let fail=true, attempts=0;
  const ready=()=>page.waitForFunction(()=>!document.body.classList.contains('busy'));
  const check=async(name,fn)=>{try{await fn();checks.push({name,passed:true});}catch(e){checks.push({name,passed:false,error:e.message});}};
  await page.route('**/api/chat', async route => {
    attempts++;
    if (!fail) return route.continue();
    await route.fulfill({contentType:'application/x-ndjson',body:[
      {type:'delta',field:'response',text:'合成未核验文字'},
      {type:'error',error:'模型原文引用校验失败，未展示无依据结果。请重试。',status:502},
    ].map(e=>JSON.stringify(e)+'\n').join('')});
  });
  try {
    await page.goto('http://127.0.0.1:8790/');
    await page.locator('#upload-consent').check();await page.locator('#persist-consent').uncheck();
    await page.locator('#upload').setInputFiles({name:`synthetic-linebreak-${Date.now()}.pdf`,mimeType:'application/pdf',buffer:pdf});
    await page.locator('.stream-failed').waitFor();await ready();
    await check('首轮失败只展示一处提示和一个重试入口', async()=>{
      assert.equal(attempts,2);
      assert.equal(await page.locator('#notice').isVisible(),false);
      assert.equal(await page.locator('#agent-start').isVisible(),false);
      assert.equal(await page.locator('#retry-chat').isVisible(),true);
      assert.equal(await page.locator('.stream-failed [role=alert]').count(),1);
      assert.doesNotMatch(await page.locator('.stream-failed .message-label').textContent(),/正在/);
    });
    await check('再次重试替换旧错误，不叠加失败卡片',async()=>{
      await page.locator('#retry-chat').click();await ready();
      assert.equal(attempts,4);
      assert.equal(await page.locator('.stream-failed').count(),1);
      assert.equal(await page.locator('.assistant-message').count(),0);
    });
    await check('PDF 跨行引用经真实解析后可保存，并分别打开两处原文',async()=>{
      fail=false;await page.locator('#retry-chat').click();await ready();
      assert.equal(attempts,5,'排版差异应直接核验通过，无需额外模型重试');
      assert.equal(await page.locator('.assistant-message').count(),1);
      assert.equal(await page.locator('.stream-preview').count(),0);
      await page.locator('.assistant-message .insight-details > summary').click();
      const sources=page.locator('.assistant-message .evidence');
      assert.equal(await sources.count(),2);
      await sources.first().click();
      assert.match(await page.locator('#source-dialog').textContent(),/Complete 5 credits/);
      await page.locator('#source-dialog').evaluate(dialog=>dialog.close());
      await sources.last().click();
      assert.match(await page.locator('#source-dialog').textContent(),/before April 30/);
      await page.locator('#source-dialog').evaluate(dialog=>dialog.close());
      assert.equal(await page.locator('#retry-chat').isVisible(),false);
    });
    console.log(JSON.stringify(checks,null,2));
    if(checks.some(c=>!c.passed))process.exitCode=1;
  } finally {await browser.close();}
})().catch(e=>{console.error(e.stack);process.exit(1);});
