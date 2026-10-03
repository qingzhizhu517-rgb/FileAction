import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, expect, it, vi } from 'vitest'
import { SessionContext } from '../../app/session'
import { ApiClient } from '../../shared/api'
import { SettingsPage } from './SettingsPage'

afterEach(() => { cleanup(); vi.unstubAllGlobals() })
it('显示独立服务能力且修改冲突不会丢失用户输入', async () => {
  vi.stubGlobal('fetch', async (url: string) => {
    if (url.endsWith('/auth/csrf')) return Response.json({ data: { csrf_token: 'synthetic' } })
    if (url.endsWith('/auth/profile')) return Response.json({ error: { code: 'REVISION_CONFLICT', message: '资料已变化，请重新核对' } }, { status: 409 })
    return Response.json({ data: { generation: { configured: true, model: 'synthetic-generation' }, embedding: { configured: false }, cos: { configured: false } } })
  })
  render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><SessionContext.Provider value={{ user: { id: 'synthetic', username: 'synthetic', display_name: '合成姓名', revision: 1 }, api: new ApiClient(), logout: async () => {} }}><SettingsPage/></SessionContext.Provider></QueryClientProvider>)
  expect(await screen.findByText('synthetic-generation')).toBeInTheDocument()
  fireEvent.change(screen.getByLabelText('显示名'), { target: { value: '用户未保存修改' } })
  fireEvent.click(screen.getByRole('button', { name: '保存显示名' }))
  expect(await screen.findByRole('alert')).toHaveTextContent('资料已变化')
  expect(screen.getByLabelText('显示名')).toHaveValue('用户未保存修改')
})
