import { beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import App from './App'

const baseSession = {
  id: 'session-1', revision: 1, document: null, facts: [], reading: null,
  artifact: null, ended: false, busy: false,
}
const documentSession = { ...baseSession, document: { id: 'doc', name: '通知.txt', hash: 'h', segments: [{ id: 's1', locator: '第1行', text: '合成通知' }], warnings: [] }, revision: 2 }

function mockFetch() {
  return vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    if (url === '/api/config') {
      return new Response(JSON.stringify({ configured: true, provider: '合成测试服务', model: 'test-model', supported_formats: ['txt', 'md'], limits: { max_bytes: 10_485_760, max_chars: 40_000 } }), { status: 200 })
    }
    if (url === '/api/session' && init?.method === 'POST') return new Response(JSON.stringify(baseSession), { status: 200 })
    if (url === '/api/session') return new Response(JSON.stringify(baseSession), { status: 200 })
    if (url.startsWith('/api/document')) return new Response(JSON.stringify(documentSession), { status: 200 })
    return new Response(JSON.stringify(baseSession), { status: 200 })
  })
}

describe('个人 MVP 前端', () => {
  beforeEach(() => {
    cleanup()
    vi.restoreAllMocks()
    vi.stubGlobal('fetch', mockFetch())
  })

  it('初始允许零背景开始，并提示先上传文件', async () => {
    render(<App />)
    expect(await screen.findByRole('heading', { name: /收到文件/ })).toBeInTheDocument()
    expect(screen.getByText(/无需先建立个人档案/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /开始解读/ })).toBeDisabled()
  })

  it('上传前不调用模型，未确认外发时解读按钮不可用', async () => {
    const user = userEvent.setup()
    const fetchMock = mockFetch()
    vi.stubGlobal('fetch', fetchMock)
    render(<App />)
    const file = new File(['合成通知\n截止日期：10月15日'], '通知.txt', { type: 'text/plain' })
    await user.upload(await screen.findByLabelText(/上传文件/), file)
    expect(await screen.findByText('通知.txt')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /同意发送并解读/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /开始解读/ })).toBeDisabled()
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes('/api/interpret'))).toBe(false)
  })

  it('解释服务失败时显示后端 detail，而不渲染预设答案', async () => {
    const user = userEvent.setup()
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url === '/api/config') return new Response(JSON.stringify({ configured: true, provider: '服务', model: 'model', supported_formats: ['txt'], limits: {} }), { status: 200 })
      if (url === '/api/session' && init?.method === 'POST') return new Response(JSON.stringify(baseSession), { status: 200 })
      if (url.startsWith('/api/document')) return new Response(JSON.stringify(documentSession), { status: 200 })
      if (url === '/api/interpret') return new Response(JSON.stringify({ detail: '模型服务暂不可用，请稍后重试' }), { status: 503 })
      return new Response(JSON.stringify(baseSession), { status: 200 })
    })
    vi.stubGlobal('fetch', fetchMock)
    render(<App />)
    await user.upload(await screen.findByLabelText(/上传文件/), new File(['合成通知'], '通知.txt', { type: 'text/plain' }))
    await user.click(await screen.findByRole('button', { name: /同意发送并解读/ }))
    await user.click(screen.getByRole('button', { name: /开始解读/ }))
    expect(await screen.findByRole('alert')).toHaveTextContent('模型服务暂不可用，请稍后重试')
    expect(screen.queryByText(/你可能需要报名/)).not.toBeInTheDocument()
  })

  it('导出使用用户编辑后的实际正文', async () => {
    const user = userEvent.setup()
    const artifact = { text: '# 初稿\n原文依据', citations: [], fact_ids: [] }
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url === '/api/config') return new Response(JSON.stringify({ configured: true, provider: '服务', model: 'model', supported_formats: ['txt'], limits: {} }), { status: 200 })
      if (url === '/api/session' && init?.method === 'POST') return new Response(JSON.stringify(baseSession), { status: 200 })
      if (url.startsWith('/api/document')) return new Response(JSON.stringify(documentSession), { status: 200 })
      if (url === '/api/interpret') return new Response(JSON.stringify({ ...baseSession, document: { id: 'doc', name: '通知.txt', hash: 'h', segments: [{ id: 's1', locator: '第1行', text: '合成通知' }], warnings: [] }, reading: { items: [], questions: [], unknowns: [], candidates: [] }, revision: 3 }), { status: 200 })
      if (url === '/api/artifact' && init?.method === 'POST') return new Response(JSON.stringify({ ...documentSession, reading: { items: [], questions: [], unknowns: [], candidates: [] }, artifact, revision: 4 }), { status: 200 })
      if (url === '/api/artifact' && init?.method === 'PATCH') return new Response(JSON.stringify({ ...documentSession, reading: { items: [], questions: [], unknowns: [], candidates: [] }, artifact: { ...artifact, text: JSON.parse(String(init.body)).text }, revision: 5 }), { status: 200 })
      if (url === '/api/export') return new Response('# 用户改过的正文', { status: 200, headers: { 'Content-Type': 'text/markdown', 'Content-Disposition': 'attachment; filename="artifact.md"' } })
      return new Response(JSON.stringify(baseSession), { status: 200 })
    })
    vi.stubGlobal('fetch', fetchMock)
    const urlSpy = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:test')
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined)
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined)
    render(<App />)
    await user.upload(await screen.findByLabelText(/上传文件/), new File(['合成通知'], '通知.txt', { type: 'text/plain' }))
    await user.click(await screen.findByRole('button', { name: /同意发送并解读/ }))
    await user.click(screen.getByRole('button', { name: /开始解读/ }))
    expect(screen.queryByRole('textbox', { name: /产物正文/ })).not.toBeInTheDocument()
    await user.click(await screen.findByRole('checkbox', { name: /同意本次起草/ }))
    await user.click(await screen.findByRole('button', { name: /生成可编辑产物/ }))
    const editor = await screen.findByRole('textbox', { name: /产物正文/ })
    await user.clear(editor)
    await user.type(editor, '# 用户改过的正文')
    await user.click(screen.getByRole('button', { name: /下载 Markdown/ }))
    await waitFor(() => expect(fetchMock.mock.calls.some(([url]) => String(url) === '/api/export')).toBe(true))
    expect(urlSpy).toHaveBeenCalled()
    const patchCall = fetchMock.mock.calls.find(([url, init]) => String(url) === '/api/artifact' && init?.method === 'PATCH')
    expect(JSON.parse(String(patchCall?.[1]?.body)).text).toBe('# 用户改过的正文')
  })

  it('本次背景显示独立保留操作，且记忆删除需要确认', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      if (String(input) === '/api/config') return new Response(JSON.stringify({ configured: false, supported_formats: ['txt'], limits: {} }))
      if (String(input) === '/api/memories') return new Response(JSON.stringify({ items: [{ id: 'm1', text: '合成保留背景', source: '用户输入', version: 1, active: true }] }))
      return new Response(JSON.stringify({ ...baseSession, facts: [{ id: 'f1', text: '合成本次背景', source: '用户输入', version: 1, memory_id: null }] }))
    }))
    render(<App />)
    expect(await screen.findByText('合成本次背景')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /保留供下次使用/ })).toBeInTheDocument()
    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: /^删除$/ }))
    expect(screen.getByRole('button', { name: /确认删除/ })).toBeInTheDocument()
  })

  it('取消后迟到的模型结果不会覆盖当前页面', async () => {
    let resolveReading: (value: Response) => void = () => undefined
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url === '/api/config') return new Response(JSON.stringify({ configured: true, provider: '合成测试服务', model: 'test', supported_formats: ['txt'], limits: {} }))
      if (url === '/api/session' && init?.method === 'POST') return new Response(JSON.stringify(baseSession))
      if (url === '/api/memories') return new Response(JSON.stringify({ items: [] }))
      if (url === '/api/interpret') return new Promise<Response>(resolve => { resolveReading = resolve })
      if (url === '/api/cancel') return new Response(JSON.stringify({ ...documentSession, revision: 4 }))
      return new Response(JSON.stringify(documentSession))
    }))
    const user = userEvent.setup()
    render(<App />)
    await user.upload(await screen.findByLabelText(/上传文件/), new File(['合成通知'], '通知.txt', { type: 'text/plain' }))
    await user.click(await screen.findByRole('button', { name: /同意发送并解读/ }))
    await user.click(screen.getByRole('button', { name: /开始解读/ }))
    await user.click(await screen.findByRole('button', { name: /^取消$/ }))
    await act(async () => { resolveReading(new Response(JSON.stringify({ ...documentSession, reading: { items: [{ title: '迟到结果', meaning: '不能显示', kind: 'fact', citations: [], fact_ids: [] }], questions: [], unknowns: [], candidates: [] } }))) })
    expect(screen.queryByText('迟到结果')).not.toBeInTheDocument()
    expect(screen.getByText('已取消当前请求。')).toBeInTheDocument()
  })

  it('取消接口迟到时不能恢复已重置的文件', async () => {
    let resolveCancel: (value: Response) => void = () => undefined
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url === '/api/config') return new Response(JSON.stringify({ configured: true, supported_formats: ['txt'], limits: {} }))
      if (url === '/api/memories') return new Response(JSON.stringify({ items: [] }))
      if (url === '/api/session' && init?.method === 'POST') return new Response(JSON.stringify(baseSession))
      if (url === '/api/interpret') return new Promise<Response>(() => undefined)
      if (url === '/api/cancel') return new Promise<Response>(resolve => { resolveCancel = resolve })
      if (url === '/api/reset') return new Response(JSON.stringify({ ...baseSession, revision: 9 }))
      return new Response(JSON.stringify(documentSession))
    }))
    const user = userEvent.setup()
    render(<App />)
    await user.upload(await screen.findByLabelText(/上传文件/), new File(['合成通知'], '通知.txt', { type: 'text/plain' }))
    await user.click(await screen.findByRole('button', { name: /同意发送并解读/ }))
    await user.click(screen.getByRole('button', { name: /开始解读/ }))
    await user.click(await screen.findByRole('button', { name: /^取消$/ }))
    await user.click(screen.getByRole('button', { name: /^重置$/ }))
    await act(async () => { resolveCancel(new Response(JSON.stringify(documentSession))) })
    expect(await screen.findByRole('heading', { name: /收到文件/ })).toBeInTheDocument()
    expect(screen.queryByText('通知.txt')).not.toBeInTheDocument()
  })

  it('保留背景编辑失败时保留输入，成功保存后退出编辑', async () => {
    let fail = true
    let text = '合成原背景'
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url === '/api/config') return new Response(JSON.stringify({ configured: false, supported_formats: ['txt'], limits: {} }))
      if (url === '/api/memories') return new Response(JSON.stringify({ items: [{ id: 'm1', text, source: '用户输入', version: 1, active: true }] }))
      if (url === '/api/memories/m1' && init?.method === 'PATCH') {
        if (fail) return new Response(JSON.stringify({ detail: '合成保存失败' }), { status: 500 })
        text = JSON.parse(String(init.body)).text
        return new Response(JSON.stringify({ id: 'm1', text, source: '用户输入', version: 2, active: true }))
      }
      return new Response(JSON.stringify(baseSession))
    }))
    const user = userEvent.setup()
    render(<App />)
    await user.click(await screen.findByRole('button', { name: '编辑保留背景' }))
    const editor = screen.getByRole('textbox', { name: '编辑保留背景' })
    await user.clear(editor); await user.type(editor, '合成修改草稿')
    await user.click(screen.getByRole('button', { name: '保存保留背景修改' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('合成保存失败')
    expect(editor).toHaveValue('合成修改草稿')
    fail = false
    await user.click(screen.getByRole('button', { name: '保存保留背景修改' }))
    expect(await screen.findByRole('button', { name: '本次复用' })).toBeInTheDocument()
    expect(screen.queryByRole('textbox', { name: '编辑保留背景' })).not.toBeInTheDocument()
  })

  it('本次背景确认失败保留草稿，重置清除草稿', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url === '/api/config') return new Response(JSON.stringify({ configured: false, supported_formats: ['txt'], limits: {} }))
      if (url === '/api/memories') return new Response(JSON.stringify({ items: [] }))
      if (url === '/api/facts') return new Response(JSON.stringify({ detail: '合成确认失败' }), { status: 500 })
      if (url === '/api/reset') return new Response(JSON.stringify(baseSession))
      return new Response(JSON.stringify(documentSession))
    }))
    const user = userEvent.setup()
    render(<App />)
    const input = await screen.findByRole('textbox', { name: '可选本次背景' })
    await user.type(input, '未提交合成草稿')
    await user.click(screen.getByRole('button', { name: '确认并用于本次' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('合成确认失败')
    expect(input).toHaveValue('未提交合成草稿')
    await user.click(screen.getByRole('button', { name: '重置' }))
    expect(input).toHaveValue('')
  })

  it.each(['PATCH', 'export'])('延迟 %s 导出操作在重置后不能回填或下载', async phase => {
    let resolvePending: (value: Response) => void = () => undefined
    const reading = { items: [], questions: [], unknowns: [], candidates: [] }
    const ready = { ...documentSession, reading, artifact: { text: '合成初稿', citations: [], fact_ids: [] } }
    const download = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined)
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:test')
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url === '/api/config') return new Response(JSON.stringify({ configured: false, supported_formats: ['txt'], limits: {} }))
      if (url === '/api/memories') return new Response(JSON.stringify({ items: [] }))
      if (url === '/api/reset') return new Response(JSON.stringify(baseSession))
      if (url === '/api/artifact') {
        if (phase === 'PATCH') return new Promise<Response>(resolve => { resolvePending = resolve })
        return new Response(JSON.stringify(ready))
      }
      if (url === '/api/export') return new Promise<Response>(resolve => { resolvePending = resolve })
      return new Response(JSON.stringify(ready))
    }))
    const user = userEvent.setup()
    render(<App />)
    await user.click(await screen.findByRole('button', { name: '下载 Markdown' }))
    await user.click(screen.getByRole('button', { name: '重置' }))
    await act(async () => { resolvePending(phase === 'PATCH' ? new Response(JSON.stringify(ready)) : new Response('合成下载文本')) })
    expect(await screen.findByRole('heading', { name: /收到文件/ })).toBeInTheDocument()
    expect(screen.queryByRole('textbox', { name: '产物正文' })).not.toBeInTheDocument()
    expect(download).not.toHaveBeenCalled()
  })

  it('旧下载被新请求取消时不会清空新请求状态', async () => {
    let rejectPatch: (reason?: unknown) => void = () => undefined
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url === '/api/config') return new Response(JSON.stringify({ configured: false, supported_formats: ['txt'], limits: {} }))
      if (url === '/api/memories') return new Response(JSON.stringify({ items: [] }))
      if (url === '/api/artifact') return new Promise<Response>((_resolve, reject) => { rejectPatch = reject })
      if (url === '/api/facts') return new Promise<Response>(() => undefined)
      if (url === '/api/reset') return new Response(JSON.stringify(baseSession))
      return new Response(JSON.stringify({ ...documentSession, reading: { items: [], questions: [], unknowns: [], candidates: [] }, artifact: { text: '草稿', citations: [], fact_ids: [] } }))
    }))
    const user = userEvent.setup()
    render(<App />)
    await user.click(await screen.findByRole('button', { name: '下载 Markdown' }))
    await user.type(screen.getByRole('textbox', { name: '可选本次背景' }), '合成新背景')
    await user.click(screen.getByRole('button', { name: '确认并用于本次' }))
    await act(async () => { rejectPatch(new DOMException('取消', 'AbortError')) })
    expect(screen.getByText('正在加入本次确认背景…')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /^取消$/ })).toBeInTheDocument()
  })
})
