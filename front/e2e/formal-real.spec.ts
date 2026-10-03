import { expect, test } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

// Real local API + PostgreSQL + Redis. Synthetic account and document.
// No HTTP mocking and no model/COS/Embedding calls.
test('真实账号注册登录、临时文件上传原文、退出销毁', async ({ page }) => {
  const username = process.env.FILEACTION_E2E_USERNAME!
  const password = 'synthetic-browser-password-only'
  await page.goto('/register')
  await page.getByLabel('显示名', { exact: true }).fill('合成浏览器账号')
  await page.getByLabel('账号', { exact: true }).fill(username)
  await page.getByLabel('密码', { exact: true }).fill(password)
  const registration = page.waitForResponse(response => response.url().endsWith('/api/v1/auth/register') && response.request().method() === 'POST')
  await page.getByRole('button', { name: '注册', exact: true }).click()
  const registrationResponse = await registration
  expect(registrationResponse.status(), await registrationResponse.text()).toBe(201)
  await page.getByRole('link', { name: '前往登录' }).click()
  await page.getByLabel('账号', { exact: true }).fill(username)
  await page.getByLabel('密码', { exact: true }).fill(password)
  await page.getByRole('button', { name: '登录', exact: true }).click()
  await expect(page.getByText('还没有保存的文件')).toBeVisible()
  await page.getByRole('button', { name: '上传文件', exact: true }).click()
  await page.getByLabel('选择文件').setInputFiles({ name: '合成流程验证.txt', mimeType: 'text/plain', buffer: Buffer.from('合成通知：请于指定时间核对材料。本输入只用于工程验收。') })
  const upload = page.waitForResponse(response => response.url().endsWith('/api/v1/documents') && response.request().method() === 'POST')
  await page.getByRole('button', { name: '开始上传' }).click()
  const uploadResponse = await upload
  expect(uploadResponse.ok(), await uploadResponse.text()).toBeTruthy()
  const documentId = (await uploadResponse.json()).data.id
  expect(documentId).toBeTruthy()
  await expect(page.getByText('合成流程验证.txt', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: '预览原文' }).click()
  await expect(page.getByText('合成通知：请于指定时间核对材料。本输入只用于工程验收。')).toBeVisible()
  await page.keyboard.press('Escape')
  await page.getByRole('button', { name: '退出登录' }).click()
  await expect(page.getByRole('button', { name: '登录', exact: true })).toBeVisible()
  await page.getByLabel('账号', { exact: true }).fill(username)
  await page.getByLabel('密码', { exact: true }).fill(password)
  await page.getByRole('button', { name: '登录', exact: true }).click()
  await expect(page.getByRole('button', { name: '上传文件', exact: true })).toBeVisible()
  await expect(page.getByText('合成流程验证.txt', { exact: true })).toHaveCount(0)
  const previousDocument = await page.request.get(`/api/v1/documents/${documentId}/source`)
  expect(previousDocument.status(), await previousDocument.text()).toBe(404)

  await page.getByRole('button', { name: '上传文件', exact: true }).click()
  await page.getByLabel('选择文件').setInputFiles({ name: '合成工作区通知.txt', mimeType: 'text/plain', buffer: Buffer.from('合成工作区原文：截止日期未提供，需要向发布方核实。') })
  const secondUpload = page.waitForResponse(response => response.url().endsWith('/api/v1/documents') && response.request().method() === 'POST')
  await page.getByRole('button', { name: '开始上传' }).click()
  const secondDocument = (await (await secondUpload).json()).data.id
  const creation = page.waitForResponse(response => response.url().endsWith('/api/v1/workspaces') && response.request().method() === 'POST')
  await page.getByRole('button', { name: '进入事务对话' }).click()
  const created = await creation
  expect(created.status(), await created.text()).toBe(201)
  const workspaceId = (await created.json()).data.id
  await expect(page.getByRole('heading', { name: '合成工作区通知.txt', exact: true })).toBeVisible()
  await page.getByLabel('本次目标', { exact: true }).fill('合成目标：先核对未知信息')
  await page.getByRole('button', { name: '更新目标', exact: true }).click()
  await expect(page.getByRole('button', { name: '更新目标', exact: true })).toBeDisabled()
  await page.getByLabel('补充本次背景').fill('合成背景：我尚未向发布方确认日期。')
  await page.getByRole('button', { name: '确认属实，仅用于本次' }).click()
  await expect(page.getByText('合成背景：我尚未向发布方确认日期。', { exact: true })).toBeVisible()
  await page.getByLabel('本次问题', { exact: true }).fill('哪些信息还需要核实？')
  let runRequests = 0
  page.on('request', request => { if (request.method() === 'POST' && request.url().endsWith('/runs')) runRequests++ })
  await page.getByRole('button', { name: '预览外发内容' }).click()
  await expect(page.getByRole('dialog')).toContainText('合成工作区原文：截止日期未提供，需要向发布方核实。')
  await expect(page.getByRole('dialog')).toContainText('合成背景：我尚未向发布方确认日期。')
  await expect(page.getByRole('dialog')).toContainText('合成目标：先核对未知信息')
  await page.getByRole('button', { name: '取消', exact: true }).click()
  expect(runRequests).toBe(0)
  await page.getByRole('button', { name: '结束本次', exact: true }).click()
  await page.getByRole('button', { name: '确认结束并清除临时内容' }).click()
  await expect(page.getByRole('heading', { name: '文件空间', exact: true })).toBeVisible()
  expect((await page.request.get('/api/v1/workspaces/' + workspaceId)).status()).toBe(404)
  expect((await page.request.get('/api/v1/documents/' + secondDocument + '/source')).status()).toBe(404)
  await page.getByRole('button', { name: '退出登录' }).click()

  // Explicit database fixture, not a simulated cloud upload. HTTP stays real.
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
  execFileSync(resolve(root, '.venv/Scripts/python.exe'), [resolve(root, 'front/e2e/seed_formal_files.py')], { env: process.env })
  await page.getByLabel('账号', { exact: true }).fill(username)
  await page.getByLabel('密码', { exact: true }).fill(password)
  await page.getByRole('button', { name: '登录', exact: true }).click()
  await expect(page.locator('.file-card')).toHaveCount(20)
  await expect(page.getByText('23 份已保存文件', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: '加载更多', exact: true }).click()
  await expect(page.locator('.file-card')).toHaveCount(23)
  await expect(page.getByRole('button', { name: '加载更多', exact: true })).toHaveCount(0)
  await page.getByLabel('搜索文件').fill('资料-22')
  await expect(page.locator('.file-card')).toHaveCount(1)
  await expect(page.getByRole('heading', { name: '合成分页资料-22.txt', exact: true })).toBeVisible()
  await page.getByLabel('搜索文件').fill('')
  await page.getByRole('button', { name: '我的材料', exact: true }).click()
  await expect(page.locator('.file-card')).toHaveCount(3)
  await page.getByRole('button', { name: '退出登录' }).click()
})
