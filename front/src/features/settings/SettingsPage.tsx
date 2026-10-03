import { useState, type FormEvent } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useSession } from '../../app/session'
import { ErrorNotice } from '../../shared/ui'
import type { Configuration, User } from '../../shared/types'
import { CLOUD_UI_ENABLED } from '../../shared/features'

export function SettingsPage() {
  const { user, api } = useSession(); const cache = useQueryClient()
  const [displayName, setDisplayName] = useState(user.display_name)
  const [error, setError] = useState<unknown>(); const [status, setStatus] = useState(''); const [busy, setBusy] = useState(false)
  const config = useQuery({ queryKey: [user.id, 'config'], queryFn: ({ signal }) => api.request<Configuration>('/config', { signal }) })
  async function saveName(e: FormEvent) {
    e.preventDefault(); setBusy(true); setError(undefined); setStatus('')
    try {
      const updated = await api.request<User>('/auth/profile', { method: 'PATCH', body: { display_name: displayName, expected_revision: user.revision } })
      cache.setQueryData(['session'], updated); setStatus('显示名已保存')
    } catch (err) { setError(err) } finally { setBusy(false) }
  }
  async function password(e: FormEvent<HTMLFormElement>) {
    e.preventDefault(); const data = new FormData(e.currentTarget); setBusy(true); setError(undefined)
    try {
      await api.request('/auth/password', { method: 'POST', body: { current_password: data.get('current_password'), new_password: data.get('new_password') } })
      api.reset(); await cache.cancelQueries(); cache.clear(); cache.setQueryData(['session'], null)
    } catch (err) { setError(err) } finally { setBusy(false) }
  }
  return <main className="page"><div className="page-heading"><div><h1>账号设置</h1><p>管理账号与服务状态，决定如何使用你的信息。</p></div></div><div className="settings-grid"><section className="settings-panel"><h2>个人账号</h2><p>账号：{user.username}</p><form onSubmit={saveName}><label>显示名<input value={displayName} onChange={e => setDisplayName(e.target.value)} maxLength={40} required/></label><button className="primary" disabled={busy}>保存显示名</button></form><p role="status">{status}</p><hr/><h2>修改密码</h2><p>修改成功后，所有旧登录会话失效，需要重新登录。</p><form onSubmit={password}><label>当前密码<input type="password" name="current_password" autoComplete="current-password" required/></label><label>新密码<input type="password" name="new_password" autoComplete="new-password" minLength={12} maxLength={128} required/></label><button disabled={busy}>修改密码并重新登录</button></form>{error != null && <ErrorNotice error={error}/>}</section><section className="settings-panel"><h2>服务与保存方式</h2>{config.isPending ? <p role="status">正在读取服务状态…</p> : config.error ? <ErrorNotice error={config.error} retry={() => void config.refetch()}/> : <><Capability title="文件解读与生成" configured={config.data?.generation?.configured} model={config.data?.generation?.model}/><Capability title="语义检索" configured={config.data?.embedding?.configured} model={config.data?.embedding?.model}/>{CLOUD_UI_ENABLED && <Capability title="云端原件保存" configured={config.data?.cos?.configured} model={config.data?.cos?.region}/>}<p className="hint">临时内容仅在本次会话使用。保存原件、建立语义索引、发送查询和模型解读分别确认；本机保存不代表模型服务看不到外发内容。</p></>}</section></div></main>
}
function Capability({ title, configured, model }: { title: string; configured?: boolean; model?: string }) { return <div className="capability"><div><h3>{title}</h3>{model && <small>{model}</small>}</div><span>{configured ? '已配置 · 待实际请求验证' : '未配置'}</span></div> }
