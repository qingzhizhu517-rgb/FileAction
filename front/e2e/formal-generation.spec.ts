import { expect, test } from '@playwright/test'
import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import type { Page } from '@playwright/test'

async function openSyntheticWorkspace(page: Page, title: string) {
  const name = 'action_' + randomUUID().replaceAll('-', '').slice(0, 18)
  const password = 'synthetic-actions-browser-only'
  await page.goto('/register')
  await page.getByLabel('显示名', { exact: true }).fill('合成成果验收账号')
  await page.getByLabel('账号', { exact: true }).fill(name)
  await page.getByLabel('密码', { exact: true }).fill(password)
  await page.getByRole('button', { name: '注册', exact: true }).click()
  await page.getByRole('link', { name: '前往登录' }).click()
  await page.getByLabel('账号', { exact: true }).fill(name)
  await page.getByLabel('密码', { exact: true }).fill(password)
  await page.getByRole('button', { name: '登录', exact: true }).click()
  await page.getByRole('button', { name: '上传文件', exact: true }).click()
  await page.getByLabel('选择文件').setInputFiles({ name: title, mimeType: 'text/plain', buffer: Buffer.from('合成通知：请核对申请资料，尚未完成任何外部提交。') })
  await page.getByRole('button', { name: '开始上传' }).click()
  await page.getByRole('button', { name: '管理语义索引', exact: true }).click()
  await page.getByRole('button', { name: '预览索引外发范围', exact: true }).click()
  await expect(page.getByRole('alert')).toContainText('Embedding服务尚未配置')
  await page.keyboard.press('Escape')
  await page.getByRole('button', { name: '进入事务对话', exact: true }).click()
  await expect(page.getByRole('heading', { name: title, exact: true })).toBeVisible()
  return page.url()
}

test('真实服务合成资料：用户创建、更新和删除行动', async ({ page }) => {
  const workspaceUrl = await openSyntheticWorkspace(page, '合成用户行动.txt')
  await page.getByRole('link', { name: '我的行动', exact: true }).click()
  await expect(page.getByText('还没有确认的行动', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: '新建行动', exact: true }).click()
  await page.getByLabel('行动标题', { exact: true }).fill('合成用户主动安排：核对资料')
  await page.getByRole('button', { name: '确认创建行动', exact: true }).click()
  await expect(page.getByRole('heading', { name: '合成用户主动安排：核对资料' })).toBeVisible()
  await page.getByLabel('合成用户主动安排：核对资料的状态').selectOption('completed')
  await expect(page.getByLabel('合成用户主动安排：核对资料的状态')).toHaveValue('completed')
  await page.reload()
  await expect(page.getByLabel('合成用户主动安排：核对资料的状态')).toHaveValue('completed')
  await page.getByRole('button', { name: '删除行动', exact: true }).click()
  await page.getByRole('button', { name: '确认删除行动', exact: true }).click()
  await expect(page.getByText('还没有确认的行动', { exact: true })).toBeVisible()
  await page.goto(workspaceUrl)
  await page.getByRole('button', { name: '结束本次', exact: true }).click()
  await page.getByRole('button', { name: '确认结束并清除临时内容', exact: true }).click()
  await page.getByRole('button', { name: '退出登录', exact: true }).click()
})

// Real local UI/API/Worker/PostgreSQL/Redis. Only the model is an explicitly
// labelled local HTTP test server. Never use this as real LLM acceptance.
test('合成HTTP模型：生成、引用、失败保留、取消及结束', async ({ page }) => {
  const name = 'gen_' + randomUUID().replaceAll('-', '').slice(0, 18)
  const password = 'synthetic-generation-browser-only'
  const source = '合成通知：请在10月15日前核对申请资料，资格仍待发布方确认。'
  await page.goto('/register')
  await page.getByLabel('显示名', { exact: true }).fill('合成生成验收账号')
  await page.getByLabel('账号', { exact: true }).fill(name)
  await page.getByLabel('密码', { exact: true }).fill(password)
  await page.getByRole('button', { name: '注册', exact: true }).click()
  await page.getByRole('link', { name: '前往登录' }).click()
  await page.getByLabel('账号', { exact: true }).fill(name)
  await page.getByLabel('密码', { exact: true }).fill(password)
  await page.getByRole('button', { name: '登录', exact: true }).click()
  await page.getByRole('button', { name: '上传文件', exact: true }).click()
  await page.getByLabel('选择文件').setInputFiles({ name: '合成生成链路.txt', mimeType: 'text/plain', buffer: Buffer.from(source) })
  await page.getByRole('button', { name: '开始上传' }).click()
  await page.getByRole('button', { name: '进入事务对话', exact: true }).click()
  await expect(page.getByRole('heading', { name: '合成生成链路.txt', exact: true })).toBeVisible()

  const runIds: string[] = []
  page.on('response', async response => {
    if (response.url().endsWith('/runs') && response.request().method() === 'POST' && response.status() === 202) {
      runIds.push((await response.json()).data.id)
    }
  })
  const start = async (message: string) => {
    await page.getByLabel('本次问题', { exact: true }).fill(message)
    await page.getByRole('button', { name: '预览外发内容', exact: true }).click()
    await expect(page.getByRole('dialog')).toContainText(source)
    await expect(page.getByRole('dialog')).toContainText('synthetic-http-test-only')
    const accepted = page.waitForResponse(response => response.url().endsWith('/runs') && response.request().method() === 'POST')
    await page.getByRole('button', { name: '同意发送并开始解读', exact: true }).click()
    const response = await accepted
    expect(response.status(), await response.text()).toBe(202)
  }
  await start('请核对这份合成通知的已知信息。')
  await expect(page.getByText('本次解读已完成', { exact: true })).toBeVisible({ timeout: 20_000 })
  await expect(page.getByRole('region', { name: '本次模型解读' })).toContainText('非真实LLM解读')
  await page.getByRole('button', { name: /查看来源 synthetic-claim-1-/ }).first().click()
  await expect(page.getByRole('dialog', { name: '核对本次引用来源' })).toContainText(source)
  await page.keyboard.press('Escape')

  // Reload forces the separate messages query to load its persisted assistant
  // summary. Changing the domain revision must invalidate that cache too.
  await page.reload()
  const oldSummary = page.getByText('这是本地合成HTTP替身的流程验收回答，非真实LLM解读。', { exact: true })
  await expect(oldSummary).toBeVisible()
  await page.getByLabel('本次目标', { exact: true }).fill('合成修改：只核对尚未确认的材料')
  await page.getByRole('button', { name: '更新目标', exact: true }).click()
  await expect(oldSummary).toHaveCount(0)

  await start('SYNTHETIC_HTTP_ERROR：明确触发测试服务错误')
  await expect(page.getByText('本次生成失败', { exact: true })).toBeVisible({ timeout: 20_000 })
  await expect(page.getByLabel('本次问题', { exact: true })).toHaveValue('SYNTHETIC_HTTP_ERROR：明确触发测试服务错误')
  await expect(page.getByRole('region', { name: '本次模型解读' })).toHaveCount(0)
  expect(runIds).toHaveLength(2)

  await start('此运行用于取消验证。')
  await page.getByRole('button', { name: '取消本次生成', exact: true }).click()
  await expect(page.getByText('本次生成已取消', { exact: true })).toBeVisible()
  await expect(page.getByRole('region', { name: '本次模型解读' })).toHaveCount(0)
  expect(runIds).toHaveLength(3)
  expect(new Set(runIds).size).toBe(3)
  expect((await page.request.get('/api/v1/runs/' + runIds[2] + '/result')).status()).toBe(409)

  await page.getByRole('button', { name: '结束本次', exact: true }).click()
  await page.getByRole('button', { name: '确认结束并清除临时内容', exact: true }).click()
  await expect(page.getByRole('heading', { name: '文件空间', exact: true })).toBeVisible()
  await page.getByRole('button', { name: '退出登录', exact: true }).click()
})

test('合成HTTP模型：确认建议、成果新版本与Markdown及ZIP下载', async ({ page }) => {
  const workspaceUrl = await openSyntheticWorkspace(page, '合成成果版本.txt')
  await page.getByLabel('本次请求', { exact: true }).selectOption('generate_artifact')
  await page.getByLabel('本次问题', { exact: true }).fill('请起草一份明确标记为合成验收的核对清单。')
  await page.getByRole('button', { name: '预览外发内容', exact: true }).click()
  await page.getByRole('button', { name: '同意发送并起草成果', exact: true }).click()
  await expect(page.getByText('本次解读已完成', { exact: true })).toBeVisible({ timeout: 20_000 })
  const beforeConfirmation = await page.request.get('/api/v1/actions')
  expect((await beforeConfirmation.json()).data.items).toHaveLength(0)
  await page.getByRole('button', { name: '确认此建议为行动 1', exact: true }).click()
  await page.getByRole('button', { name: '确认创建此行动', exact: true }).click()
  await expect(page.getByText('已确认创建', { exact: true })).toBeVisible()
  expect((await (await page.request.get('/api/v1/actions')).json()).data.items).toHaveLength(1)
  await page.getByRole('link', { name: '查看、编辑与下载本次成果', exact: true }).click()
  await page.getByRole('button', { name: '查看与编辑 合成HTTP替身草稿', exact: true }).click()
  const original = '# 合成验收草稿\n\n此正文来自本地HTTP测试替身，非真实模型生成。'
  const edited = '# 合成用户编辑版本\n\n仅用于验收；已由用户手动修改，尚未提交任何外部申请。'
  await expect(page.getByRole('textbox', { name: '成果正文', exact: true })).toHaveValue(original)
  await page.getByRole('textbox', { name: '成果正文', exact: true }).fill(edited)
  await page.getByRole('button', { name: '保存为新版本', exact: true }).click()
  await expect(page.getByRole('combobox', { name: '查看版本', exact: true })).toHaveValue('2')
  const currentDownload = page.waitForEvent('download')
  await page.getByRole('button', { name: '下载此版本 Markdown', exact: true }).click()
  const current = await currentDownload
  expect(current.suggestedFilename()).toContain('-v2.md')
  expect(await readFile((await current.path())!, 'utf8')).toContain(edited)
  await page.getByRole('combobox', { name: '查看版本', exact: true }).selectOption('1')
  await expect(page.getByRole('textbox', { name: '成果正文', exact: true })).toHaveValue(original)
  await page.getByRole('button', { name: '下载此版本 Markdown', exact: true }).click()
  await expect(page.getByRole('button', { name: '确认下载所选版本', exact: true })).toBeVisible()
  const historyDownload = page.waitForEvent('download')
  await page.getByRole('button', { name: '确认下载所选版本', exact: true }).click()
  const history = await historyDownload
  expect(history.suggestedFilename()).toContain('-v1.md')
  const historicalBody = await readFile((await history.path())!, 'utf8')
  expect(historicalBody).toContain(original)
  expect(historicalBody).not.toContain(edited)
  await page.keyboard.press('Escape')
  await page.getByLabel('选择此成果加入 ZIP', { exact: true }).check()
  await expect(page.getByRole('combobox', { name: 'ZIP导出版本', exact: true })).toHaveValue('2')
  await page.getByRole('button', { name: '下载所选版本 ZIP（1）', exact: true }).click()
  const zipDownload = page.waitForEvent('download')
  await page.getByRole('button', { name: '确认下载所选 ZIP', exact: true }).click()
  const zip = await zipDownload
  expect(zip.suggestedFilename()).toBe('文启成果包.zip')
  const zipBytes = await readFile((await zip.path())!)
  expect([...zipBytes.subarray(0, 4)]).toEqual([0x50, 0x4b, 0x03, 0x04])
  expect(zipBytes.includes(Buffer.from('.md'))).toBe(true)
  await page.goto(workspaceUrl)
  await page.getByRole('button', { name: '结束本次', exact: true }).click()
  await page.getByRole('button', { name: '确认结束并清除临时内容', exact: true }).click()
  await page.getByRole('button', { name: '退出登录', exact: true }).click()
})
