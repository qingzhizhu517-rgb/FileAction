import {test,expect} from '@playwright/test';
import {randomUUID} from 'node:crypto';

// Real UI/API/PG/Redis and both workers. Generation and Embedding are explicit
// local HTTP substitutes, with test-only transport rewriting for Embedding.
test('合成Embedding：独立索引授权与查询授权后混合检索生成',async({page})=>{
  const name='rag_'+randomUUID().replaceAll('-','').slice(0,18);
  const password='synthetic-hybrid-browser-only';
  await page.goto('/register');
  await page.getByLabel('显示名',{exact:true}).fill('合成RAG账号');
  await page.getByLabel('账号',{exact:true}).fill(name);
  await page.getByLabel('密码',{exact:true}).fill(password);
  await page.getByRole('button',{name:'注册',exact:true}).click();
  await page.getByRole('link',{name:'前往登录'}).click();
  await page.getByLabel('账号',{exact:true}).fill(name);
  await page.getByLabel('密码',{exact:true}).fill(password);
  await page.getByRole('button',{name:'登录',exact:true}).click();
  await page.getByRole('button',{name:'上传文件',exact:true}).click();
  const source='合成通知：申请材料应在十月十五日前核对，最终资格以正式通知为准。';
  await page.getByLabel('选择文件').setInputFiles({name:'合成RAG通知.txt',mimeType:'text/plain',buffer:Buffer.from(source)});
  await page.getByRole('button',{name:'开始上传',exact:true}).click();
  await page.getByRole('button',{name:'管理语义索引',exact:true}).click();
  await page.getByRole('button',{name:'预览索引外发范围',exact:true}).click();
  await expect(page.getByRole('region',{name:'索引外发预览'})).toContainText(source);
  await expect(page.getByRole('button',{name:'同意发送并建立语义索引'})).toBeDisabled();
  await page.getByRole('checkbox',{name:'同意将以上片段发送给所示 Embedding 服务'}).check();
  await page.getByRole('button',{name:'同意发送并建立语义索引'}).click();
  await expect(page.getByRole('heading',{name:'语义索引已就绪',exact:true})).toBeVisible({timeout:20_000});
  await page.keyboard.press('Escape');
  await page.getByRole('button',{name:'进入事务对话',exact:true}).click();
  await page.getByRole('combobox',{name:'检索方式',exact:true}).selectOption('hybrid');
  await page.getByLabel('本次问题',{exact:true}).fill('申请材料应在什么时间核对？');
  await page.getByRole('button',{name:'预览外发内容',exact:true}).click();
  const consent=page.getByRole('checkbox',{name:'同意将本次查询及授权上下文内的派生检索词发送给 Embedding 服务'});
  await expect(consent).not.toBeChecked();
  await expect(page.getByRole('button',{name:'同意发送并开始解读',exact:true})).toBeDisabled();
  await consent.check();
  await page.getByRole('button',{name:'同意发送并开始解读',exact:true}).click();
  await expect(page.getByText('本次解读已完成',{exact:true})).toBeVisible({timeout:20_000});
  await expect(page.getByRole('region',{name:'本次模型解读'})).toContainText('非真实LLM解读');
  await page.getByRole('button',{name:/查看来源 synthetic-claim-1-/}).first().click();
  await expect(page.getByRole('dialog',{name:'核对本次引用来源'})).toContainText(source);
  await page.keyboard.press('Escape');
  await page.getByRole('button',{name:'结束本次',exact:true}).click();
  await page.getByRole('button',{name:'确认结束并清除临时内容',exact:true}).click();
  await page.getByRole('button',{name:'退出登录',exact:true}).click();
});
