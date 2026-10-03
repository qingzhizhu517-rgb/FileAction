// 手动真实模型冒烟：只发送此处合成通知，不保存背景；会产生真实模型请求。
// node front/scripts/real_model_smoke.mjs --confirm-real-model --url=http://127.0.0.1:8767
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { chromium, expect } from '@playwright/test'

if (!process.argv.includes('--confirm-real-model')) {
  console.error('请明确加上 --confirm-real-model；此脚本会调用配置中的真实模型。')
  process.exit(2)
}
const base = new URL(process.argv.find(arg => arg.startsWith('--url='))?.slice(6) || 'http://127.0.0.1:8766')
assert.ok(base.protocol === 'http:' && ['127.0.0.1', 'localhost'].includes(base.hostname))
const notice = '合成通知，仅用于真实模型连通测试，不是真实活动。\n合成读书活动报名截止为2026年10月15日。\n申请资格未列明，需要向发布方核实；本通知不代表报名成功。'
const summary = { synthetic: true, timestamp: new Date().toISOString(), phase: 'startup' }
const browser = await chromium.launch({ headless: true })
const context = await browser.newContext()
const page = await context.newPage()
page.setDefaultTimeout(10_000)
let sessionId
let exitCode = 0
async function result(responsePromise, phase) {
  summary.phase = phase
  const response = await responsePromise
  console.log(JSON.stringify({ phase, status: response.status() }))
  assert.equal(response.status(), 200)
  return response.json()
}
try {
  const config = await (await context.request.get(new URL('/api/config', base).href)).json()
  assert.equal(config.configured, true)
  summary.configured = true
  const sessionResponse = page.waitForResponse(r => r.url().endsWith('/api/session') && r.request().method() === 'POST')
  await page.goto(base.href)
  sessionId = (await (await sessionResponse).json()).id
  const uploaded = page.waitForResponse(r => r.url().includes('/api/document?') && r.request().method() === 'POST')
  await page.getByLabel(/上传文件/).setInputFiles({ name: '合成模型连通通知.txt', mimeType: 'text/plain', buffer: Buffer.from(notice) })
  const source = await result(uploaded, 'upload')
  assert.equal(source.facts.length, 0)
  await expect(page.getByRole('button', { name: /开始解读/ })).toBeDisabled()
  await page.getByRole('button', { name: /同意发送并解读/ }).click()
  const interpreted = page.waitForResponse(r => r.url().endsWith('/api/interpret'), { timeout: 70_000 })
  const interpretStarted = Date.now()
  await page.getByRole('button', { name: /开始解读/ }).click()
  const readingSession = await result(interpreted, 'interpret')
  summary.interpret_ms = Date.now() - interpretStarted
  const reading = readingSession.reading
  assert.ok(reading.items.length > 0)
  const citations = reading.items.flatMap(item => item.citations)
  assert.ok(citations.length > 0)
  for (const citation of citations) {
    assert.ok(source.document.segments.find(segment => segment.id === citation.segment_id)?.text.includes(citation.quote))
  }
  summary.items = reading.items.length
  summary.citations = citations.length
  summary.unknowns = reading.unknowns.length
  await page.getByRole('button', { name: '查看依据', exact: true }).first().click()
  await expect(page.locator('blockquote').first()).toContainText(citations[0].quote)
  await page.getByLabel('同意本次起草').check()
  const generated = page.waitForResponse(r => r.url().endsWith('/api/artifact') && r.request().method() === 'POST', { timeout: 70_000 })
  const artifactStarted = Date.now()
  await page.getByRole('button', { name: /生成可编辑产物/ }).click()
  const artifactSession = await result(generated, 'artifact')
  summary.artifact_ms = Date.now() - artifactStarted
  assert.ok(artifactSession.artifact.text.trim().length > 0)
  const editor = page.getByRole('textbox', { name: /产物正文/ })
  await expect(editor).toHaveValue(artifactSession.artifact.text)
  const marker = '合成测试人工编辑：尚未报名，资格待核实。'
  await editor.fill(artifactSession.artifact.text + '\n\n' + marker)
  const downloaded = page.waitForEvent('download')
  await page.getByRole('button', { name: /下载 Markdown/ }).click()
  const download = await downloaded
  const path = await download.path()
  assert.ok(path)
  const exported = await readFile(path, 'utf8')
  assert.ok(exported.includes(marker))
  summary.export_bytes = Buffer.byteLength(exported)
  const ended = page.waitForResponse(r => r.url().endsWith('/api/end'))
  await page.getByRole('button', { name: '结束本次', exact: true }).click()
  const ending = await result(ended, 'end')
  assert.equal(ending.ended, true)
  assert.equal(ending.document, null)
  await expect(editor).toHaveCount(0)
  summary.phase = 'complete'
  summary.passed = true
} catch (error) {
  summary.passed = false
  summary.error_type = error.name
  // 不输出原始供应商响应、配置值、已保存背景或截图。
  exitCode = 1
} finally {
  if (sessionId) await context.request.post(new URL('/api/end', base).href, { headers: { 'X-Session-ID': sessionId } }).catch(() => {})
  await browser.close()
  console.log(JSON.stringify(summary))
}
process.exitCode = exitCode
