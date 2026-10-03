import { expect, test } from '@playwright/test'
import { mkdir } from 'node:fs/promises'

// Formal UI contract tests: synthetic accounts and HTTP responses only.
// This does not verify PostgreSQL, COS, Redis, Embedding or generation.
test.beforeEach(async ({ page }) => {
  let active: null | string = null
  await page.route('**/api/v1/**', async route => {
    const request = route.request()
    const path = new URL(request.url()).pathname.replace('/api/v1', '')
    const data = (value: unknown) => route.fulfill({ json: { data: value, request_id: 'synthetic-browser' } })
    const error = (status: number, code: string, message: string) => route.fulfill({ status, json: { error: { code, message, request_id: 'synthetic-browser' } } })
    const user = () => ({ id: 'synthetic-' + active, username: active, display_name: active === 'alice' ? '合成甲' : '合成乙', revision: 1 })
    if (path === '/auth/csrf') return data({ csrf_token: 'synthetic-csrf' })
    if (request.method() !== 'GET' && request.headers()['x-csrf-token'] !== 'synthetic-csrf') return error(403, 'CSRF_REJECTED', 'CSRF验证失败')
    if (path === '/auth/login') {
      const body = request.postDataJSON()
      if (body.password !== 'synthetic-password') return error(401, 'INVALID_CREDENTIALS', '账号或密码错误')
      active = body.username
      return data({ user: user(), csrf_token: 'synthetic-csrf' })
    }
    if (path === '/auth/logout') { active = null; return route.fulfill({ status: 204 }) }
    if (!active) return error(401, 'AUTH_REQUIRED', '请先登录')
    if (path === '/auth/me') return data(user())
    if (path === '/config') return data({ storage_notice_version: '1', cos: { configured: false, region: '未配置' } })
    if (path === '/workspaces/temporary') return data([])
    if (path === '/documents' && request.method() === 'POST') return error(503, 'DEPENDENCY_UNAVAILABLE', '临时存储暂不可用')
    if (path === '/documents') return data(active === 'alice' ? [{ id: 'synthetic-doc', name: '合成甲私有文件.txt', retention: 'retained', revision: 1, parse_status: 'ready', index_status: 'not_indexed' }] : [])
    return error(404, 'RESOURCE_NOT_FOUND', '资源不存在')
  })
})

async function login(page: import('@playwright/test').Page, username: string) {
  await page.goto('/login')
  await page.getByLabel('账号', { exact: true }).fill(username)
  await page.getByLabel('密码', { exact: true }).fill('synthetic-password')
  await page.getByRole('button', { name: '登录', exact: true }).click()
  await expect(page.getByRole('heading', { name: '文件空间', exact: true })).toBeVisible()
}

test('退出后第二个账号不继承前一个账号的文件缓存', async ({ page }) => {
  await login(page, 'alice')
  await expect(page.getByText('合成甲私有文件.txt')).toBeVisible()
  await page.getByRole('button', { name: '退出登录' }).click()
  await expect(page.getByRole('button', { name: '登录', exact: true })).toBeVisible()
  await page.getByLabel('账号', { exact: true }).fill('bob')
  await page.getByLabel('密码', { exact: true }).fill('synthetic-password')
  await page.getByRole('button', { name: '登录', exact: true }).click()
  await expect(page.getByText('还没有保存的文件')).toBeVisible()
  await expect(page.getByText('合成甲私有文件.txt')).toHaveCount(0)
  expect(await page.evaluate(() => localStorage.length)).toBe(0)
})

test('浏览器实际上传：默认临时，失败可恢复，关闭返回焦点', async ({ page }) => {
  await login(page, 'bob')
  await page.getByRole('button', { name: '上传文件' }).click()
  await page.getByLabel('选择文件').setInputFiles({ name: '合成通知.txt', mimeType: 'text/plain', buffer: Buffer.from('合成通知：仅作工程测试。') })
  const request = page.waitForRequest(r => r.method() === 'POST' && r.url().endsWith('/documents'))
  await page.getByRole('button', { name: '开始上传' }).click()
  const sent = await request
  expect(sent.postDataBuffer()?.toString('utf8')).toContain('temporary')
  await expect(page.getByRole('alert')).toContainText('临时存储暂不可用')
  await expect(page.getByRole('button', { name: '开始上传' })).toBeEnabled()
  await page.keyboard.press('Escape')
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await expect(page.getByRole('button', { name: '上传文件' })).toBeFocused()
})

for (const width of [390, 768, 1440]) {
  test('高保真正式页面布局 ' + width, async ({ page }) => {
    await page.setViewportSize({ width, height: 960 })
    await login(page, 'alice')
    await expect(page.getByText('合成甲私有文件.txt')).toBeVisible()
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    await mkdir('../.planning/2026-10-03-formal-ui-verification', { recursive: true })
    await page.screenshot({ path: '../.planning/2026-10-03-formal-ui-verification/files-' + width + '.png', fullPage: true })
  })
}

test('云存储授权在更换文件后撤销，上传成功不自动创建工作区', async ({ page }) => {
  await login(page, 'bob')
  let workspaces = 0
  await page.route('**/api/v1/config', route => route.fulfill({ json: { data: { storage_notice_version: '1', cos: { configured: true, region: '合成测试地域' } } } }))
  await page.route('**/api/v1/workspaces', route => { workspaces++; return route.fulfill({ json: { data: { id: 'synthetic-w' } } }) })
  await page.route('**/api/v1/documents', route => route.request().method() === 'POST'
    ? route.fulfill({ status: 202, json: { data: { id: 'synthetic-upload', name: '合成乙.txt', retention: 'retained', parse_status: 'parsing', index_status: 'not_requested', revision: 1 } } })
    : route.fulfill({ json: { data: [] } }))
  await page.getByRole('button', { name: '上传文件' }).click()
  await page.getByLabel('选择文件').setInputFiles({ name: '合成甲.txt', mimeType: 'text/plain', buffer: Buffer.from('合成甲') })
  await page.getByRole('radio', { name: '保存到文件空间' }).check()
  await page.getByRole('checkbox', { name: '我同意将此原件保存到上述云存储' }).check()
  await page.getByLabel('选择文件').setInputFiles({ name: '合成乙.txt', mimeType: 'text/plain', buffer: Buffer.from('合成乙') })
  await expect(page.getByRole('checkbox')).not.toBeChecked()
  await expect(page.getByRole('button', { name: '开始上传' })).toBeDisabled()
  await page.getByRole('checkbox').check()
  await page.getByRole('button', { name: '开始上传' }).click()
  await expect(page.getByText('合成乙.txt')).toBeVisible()
  await expect(page).toHaveURL(/\/files$/)
  expect(workspaces).toBe(0)
})
