import { test, expect } from '@playwright/test'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

// 真实浏览器 + 真实产品后端；唯一替身是本机HTTP模型服务。
// 不将这些用例报告为真实LLM能力通过。
async function upload(page: import('@playwright/test').Page, text = '合成通知：教育项目招募\n请先核实申请资格。') {
  await page.goto('/')
  await expect(page.getByRole('heading', { name: /收到文件/ })).toBeVisible()
  await page.getByLabel(/上传文件/).setInputFiles({ name: '合成通知.txt', mimeType: 'text/plain', buffer: Buffer.from(text) })
  await expect(page.getByText('合成通知.txt', { exact: true }).first()).toBeVisible()
}

async function interpret(page: import('@playwright/test').Page) {
  await page.getByRole('button', { name: /同意发送并解读/ }).click()
  await page.getByRole('button', { name: /开始解读/ }).click()
  await expect(page.getByText('合成通知的申请要求', { exact: true })).toBeVisible()
}

test('零背景上传无需建档，解读和保存分别确认', async ({ page }) => {
  await upload(page)
  await expect(page.getByRole('button', { name: /开始解读/ })).toBeDisabled()
  await interpret(page)
  await expect(page.getByText('实际资格尚未核实。', { exact: true }).first()).toBeVisible()
  await expect(page.getByRole('textbox', { name: /产物正文/ })).toHaveCount(0)
})

test('选择继续后编辑并下载实际Markdown正文', async ({ page }) => {
  await upload(page)
  await interpret(page)
  await page.getByLabel('同意本次起草').check()
  await page.getByRole('button', { name: /生成可编辑产物/ }).click()
  const editor = page.getByRole('textbox', { name: /产物正文/ })
  await expect(editor).toBeVisible()
  await editor.fill('# 用户实际编辑后的合成提纲\n\n请核实资格，尚未报名。')
  const downloaded = page.waitForEvent('download')
  await page.getByRole('button', { name: /下载 Markdown/ }).click()
  const download = await downloaded
  const path = await download.path()
  expect(path).not.toBeNull()
  const content = await readFile(path!, 'utf8')
  expect(content).toContain('用户实际编辑后的合成提纲')
  expect(content).toContain('尚未报名')
  expect(content).toContain('合成通知')
})

test('原文依据可展开，补充可跳过并只理解后结束', async ({ page }) => {
  await upload(page)
  await interpret(page)
  await page.getByRole('button', { name: '查看依据', exact: true }).first().click()
  await expect(page.locator('blockquote').first()).toContainText('合成通知')
  await page.getByRole('button', { name: '补充', exact: true }).first().click()
  await page.getByRole('textbox', { name: '补充回答', exact: true }).fill('这条未确认合成回答不应保存')
  await page.getByRole('button', { name: '跳过', exact: true }).click()
  await expect(page.getByText('合成通知的申请要求', { exact: true })).toBeVisible()
  await expect(page.getByText('目前没有已保存的背景。')).toBeVisible()
  await page.getByRole('button', { name: '结束本次', exact: true }).click()
  await expect(page.getByText('合成通知的申请要求', { exact: true })).toHaveCount(0)
  await expect(page.getByRole('textbox', { name: /产物正文/ })).toHaveCount(0)
})

test('取消在途解读后迟到响应不回填', async ({ page }) => {
  await upload(page, '[SLOW] 合成慢响应文件')
  await page.getByRole('button', { name: /同意发送并解读/ }).click()
  const request = page.waitForRequest(req => req.url().endsWith('/api/interpret'))
  await page.getByRole('button', { name: /开始解读/ }).click()
  await request
  await page.getByRole('button', { name: '取消', exact: true }).click()
  await expect(page.getByText('已取消当前请求。')).toBeVisible()
  // 替身3秒后返回；等待越过该边界以验证没有迟到回填。
  await page.waitForTimeout(3500)
  await expect(page.getByText('合成通知的申请要求', { exact: true })).toHaveCount(0)
  await expect(page.getByRole('textbox', { name: /产物正文/ })).toHaveCount(0)
})

test('失败后可重新授权重试，界面不会保留成功结果', async ({ page }) => {
  await upload(page, '[INVALID_CITATION] 合成文件')
  for (let attempt = 0; attempt < 2; attempt += 1) {
    await page.getByRole('button', { name: /同意发送并解读/ }).click()
    const response = page.waitForResponse(res => res.url().endsWith('/api/interpret'))
    await page.getByRole('button', { name: /开始解读/ }).click()
    expect((await response).status()).toBe(502)
    await expect(page.getByRole('alert')).toBeVisible()
    await expect(page.getByRole('button', { name: /开始解读/ })).toBeDisabled()
  }
})

test('没有模型配置时明确失败且允许只查看本机原文', async ({ page }) => {
  await page.goto(process.env.E2E_UNCONFIGURED_URL || 'http://127.0.0.1:8778')
  await page.getByLabel(/上传文件/).setInputFiles({ name: '合成未配置.md', mimeType: 'text/markdown', buffer: Buffer.from('# 合成文件\n这是未配置模型的本机读取。') })
  await page.getByRole('button', { name: /同意发送并解读/ }).click()
  await page.getByRole('button', { name: /开始解读/ }).click()
  await expect(page.getByRole('alert')).toContainText(/未配置|配置不完整/)
  await expect(page.getByText('合成通知的申请要求', { exact: true })).toHaveCount(0)
  await expect(page.getByText('这是未配置模型的本机读取。', { exact: true }).first()).toBeVisible()
})

test('移动端完整首屏与合成文件解读没有横向溢出', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await upload(page)
  await interpret(page)
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
  await page.screenshot({ path: 'test-results/mobile-reading.png', fullPage: true })
})

test('不可定位引用必须显示失败', async ({ page }) => {
  await upload(page, '[INVALID_CITATION] 合成文件')
  await page.getByRole('button', { name: /同意发送并解读/ }).click()
  await page.getByRole('button', { name: /开始解读/ }).click()
  await expect(page.getByRole('alert')).toBeVisible()
  await expect(page.getByText('合成通知的申请要求', { exact: true })).toHaveCount(0)
})

test('确认背景不自动保留，修改停用和删除使旧结果失效', async ({ page }) => {
  await upload(page)
  await page.getByRole('button', { name: /同意发送并解读/ }).click()
  await page.getByRole('textbox', { name: '可选本次背景', exact: true }).fill('合成背景：正在准备教育实践')
  await page.getByRole('button', { name: '确认并用于本次', exact: true }).click()
  const fact = page.getByTestId('confirmed-fact')
  await expect(fact).toContainText('正在准备教育实践')
  await expect(page.getByTestId('saved-memory')).toHaveCount(0)
  await expect(page.getByRole('button', { name: /开始解读/ })).toBeDisabled()
  await fact.getByRole('button', { name: '保留供下次使用', exact: true }).click()
  const memory = page.getByTestId('saved-memory')
  await expect(memory).toContainText('正在准备教育实践')
  await interpret(page)
  await page.getByLabel('同意本次起草').check()
  await page.getByRole('button', { name: /生成可编辑产物/ }).click()
  await expect(page.getByRole('textbox', { name: /产物正文/ })).toBeVisible()
  await memory.getByRole('button', { name: '编辑保留背景', exact: true }).click()
  await memory.getByRole('textbox', { name: '编辑保留背景', exact: true }).fill('合成背景：改为了解报名条件')
  await memory.getByRole('button', { name: '保存保留背景修改', exact: true }).click()
  await expect(memory).toContainText('改为了解报名条件')
  await expect(page.getByRole('textbox', { name: /产物正文/ })).toHaveCount(0)
  await expect(page.getByText('合成通知的申请要求', { exact: true })).toHaveCount(0)
  await expect(fact).toHaveCount(0)
  await memory.getByRole('button', { name: '本次复用', exact: true }).click()
  await expect(fact).toContainText('改为了解报名条件')
  await interpret(page)
  await memory.getByRole('button', { name: '停用', exact: true }).click()
  await expect(memory).toContainText('已停用')
  await expect(memory.getByRole('button', { name: '本次复用', exact: true })).toBeDisabled()
  await expect(page.getByText('合成通知的申请要求', { exact: true })).toHaveCount(0)
  await memory.getByRole('button', { name: '启用', exact: true }).click()
  await memory.getByRole('button', { name: '删除', exact: true }).click()
  await memory.getByRole('button', { name: '取消删除', exact: true }).click()
  await expect(memory).toHaveCount(1)
  await memory.getByRole('button', { name: '删除', exact: true }).click()
  await memory.getByRole('button', { name: '确认删除', exact: true }).click()
  await expect(memory).toHaveCount(0)
})

test('补充回答使用当前输入且不自动保存', async ({ page }) => {
  await upload(page)
  await interpret(page)
  await page.getByRole('button', { name: '补充', exact: true }).first().click()
  await page.getByRole('textbox', { name: '补充回答', exact: true }).fill('合成回答：只想核实截止时间')
  await page.locator('.question-answer').getByRole('button', { name: '确认用于本次', exact: true }).click()
  await expect(page.getByTestId('confirmed-fact')).toContainText('只想核实截止时间')
  await expect(page.getByTestId('saved-memory')).toHaveCount(0)
  await expect(page.getByText('合成通知的申请要求', { exact: true })).toHaveCount(0)
  await expect(page.getByRole('button', { name: /开始解读/ })).toBeDisabled()
})

test('上传错误可恢复，结束后可主动开始新会话', async ({ page }) => {
  await page.goto('/')
  await page.getByLabel(/上传文件/).setInputFiles({ name: '合成空文件.txt', mimeType: 'text/plain', buffer: Buffer.from('') })
  await expect(page.getByRole('alert')).toContainText(/空|没有/)
  await page.getByLabel(/上传文件/).setInputFiles({ name: '合成有效.txt', mimeType: 'text/plain', buffer: Buffer.from('合成有效输入') })
  await expect(page.getByRole('heading', { name: '合成有效.txt', exact: true })).toBeVisible()
  await page.getByRole('button', { name: '结束本次', exact: true }).click()
  await expect(page.getByLabel(/上传文件/)).toBeDisabled()
  await page.getByRole('button', { name: '开始新会话', exact: true }).click()
  await expect(page.getByRole('button', { name: '开始新会话', exact: true })).toHaveCount(0)
  await expect(page.getByLabel(/上传文件/)).toBeEnabled()
  await page.getByLabel(/上传文件/).setInputFiles({ name: '合成第二份.txt', mimeType: 'text/plain', buffer: Buffer.from('合成新会话输入') })
  await expect(page.getByRole('heading', { name: '合成第二份.txt', exact: true })).toBeVisible()
  await expect(page.getByRole('alert')).toHaveCount(0)
})

test('重置使在途解读失效且保留可重新上传入口', async ({ page }) => {
  await upload(page, '[SLOW] 合成重置文件')
  await page.getByRole('button', { name: /同意发送并解读/ }).click()
  const request = page.waitForRequest(req => req.url().endsWith('/api/interpret'))
  await page.getByRole('button', { name: /开始解读/ }).click()
  await request
  await page.getByRole('button', { name: '重置', exact: true }).click()
  await expect(page.getByRole('heading', { name: /收到文件/ })).toBeVisible()
  await page.waitForTimeout(3500)
  await expect(page.getByText('合成通知的申请要求', { exact: true })).toHaveCount(0)
  await expect(page.getByLabel(/上传文件/)).toBeEnabled()
})

for (const fixture of [
  { name: 'synthetic.pdf', locator: '第1页', text: 'Synthetic notice: browser test only.' },
  { name: 'synthetic.docx', locator: '表格', text: '合成表格：请核实申请要求' },
]) {
  test(`真实浏览器上传并定位合成 ${fixture.name}`, async ({ page }) => {
    await page.goto('/')
    expect(process.env.E2E_FIXTURES_DIR, '请通过front/e2e/run.py创建隔离的合成文档').toBeTruthy()
    await page.getByLabel(/上传文件/).setInputFiles(join(process.env.E2E_FIXTURES_DIR!, fixture.name))
    await expect(page.getByRole('heading', { name: fixture.name, exact: true })).toBeVisible()
    await expect(page.locator('.segments')).toContainText(fixture.locator)
    await expect(page.locator('.segments')).toContainText(fixture.text)
    await interpret(page)
  })
}

test('文件和引用里的HTML被当成文本显示', async ({ page }) => {
  await upload(page, '<img src=x onerror=window.syntheticInjected=true> 合成输入')
  await interpret(page)
  await page.getByRole('button', { name: '查看依据', exact: true }).first().click()
  await expect(page.locator('.segments')).toContainText('<img src=x')
  await expect(page.locator('.segments img')).toHaveCount(0)
  expect(await page.evaluate(() => (window as unknown as Record<string, unknown>).syntheticInjected)).toBeUndefined()
  await page.screenshot({ path: 'test-results/desktop-reading.png', fullPage: true })
})

test('实际自定义目标经过独立授权发送，重置清除未提交输入', async ({ page }) => {
  await upload(page)
  await interpret(page)
  await page.getByRole('combobox', { name: '我想先', exact: true }).selectOption('按我的目标起草一段文字')
  await page.getByRole('textbox', { name: '自定义起草目标', exact: true }).fill('合成目标：写一份给发布方核实时间的提纲')
  await page.getByLabel('同意本次起草').check()
  await page.getByRole('textbox', { name: '自定义起草目标', exact: true }).fill('合成目标：核实资格和截止时间')
  await expect(page.getByRole('button', { name: /生成可编辑产物/ })).toBeDisabled()
  await page.getByLabel('同意本次起草').check()
  const request = page.waitForRequest(req => req.url().endsWith('/api/artifact') && req.method() === 'POST')
  await page.getByRole('button', { name: /生成可编辑产物/ }).click()
  expect((await request).postDataJSON().goal).toBe('合成目标：核实资格和截止时间')
  await expect(page.getByRole('textbox', { name: /产物正文/ })).toBeVisible()
  await page.getByRole('textbox', { name: '可选本次背景', exact: true }).fill('合成未提交私密草稿')
  await page.getByRole('button', { name: '重置', exact: true }).click()
  await expect(page.getByLabel(/上传文件/)).toBeEnabled()
  await expect(page.getByRole('textbox', { name: '可选本次背景', exact: true })).toHaveValue('')
  await page.getByLabel(/上传文件/).setInputFiles({ name: '合成重置后.txt', mimeType: 'text/plain', buffer: Buffer.from('合成重置后的文件') })
  await interpret(page)
  await page.getByRole('combobox', { name: '我想先', exact: true }).selectOption('按我的目标起草一段文字')
  await expect(page.getByRole('textbox', { name: '自定义起草目标', exact: true })).toHaveValue('')
})
