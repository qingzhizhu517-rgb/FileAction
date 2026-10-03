import { useCallback, useEffect, useRef, useState } from 'react'
import type { Dispatch, SetStateAction } from 'react'
import { ArrowRight, Check, ChevronDown, ChevronUp, Download, FileText, LoaderCircle, RotateCcw, ShieldCheck, Sparkles, Trash2, X } from 'lucide-react'
import * as api from './api'
import type { Config, Fact, Memory, Reading, Session } from './types'
import './styles.css'

const emptySession: Session = { id: '', revision: 0, document: null, facts: [], reading: null, artifact: null, ended: false, busy: false }

function kindLabel(kind: string) {
  if (kind === 'fact') return '文件事实'
  if (kind === 'inference') return '系统推断'
  return '待核实'
}

export default function App() {
  const [config, setConfig] = useState<Config | null>(null)
  const [session, setSession] = useState<Session>(emptySession)
  const [memories, setMemories] = useState<Memory[]>([])
  const [consent, setConsent] = useState(false)
  const [artifactConsent, setArtifactConsent] = useState(false)
  const [pending, setPending] = useState(false)
  const [customGoal, setCustomGoal] = useState('')
  const [clearBackgroundEpoch, setClearBackgroundEpoch] = useState(0)
  const [goal, setGoal] = useState('核实这份文件中的要求')
  const [factDraft, setFactDraft] = useState('')
  const [candidateDrafts, setCandidateDrafts] = useState<Record<number, boolean>>({})
  const [expanded, setExpanded] = useState<Record<string, boolean>>({})
  const [error, setError] = useState('')
  const [status, setStatus] = useState('')
  const [loading, setLoading] = useState(true)
  const [uploading, setUploading] = useState(false)
  const [artifactText, setArtifactText] = useState('')
  const [selectedQuestion, setSelectedQuestion] = useState<number | null>(null)
  const [questionAnswer, setQuestionAnswer] = useState('')
  const requestId = useRef(0)
  const controller = useRef<AbortController | null>(null)
  const acceptFormats = config?.supported_formats?.length ? config.supported_formats.map(format => `.${format.replace(/^\./, '')}`).join(',') : '.txt,.md'
  const formatLabel = config?.supported_formats?.length ? config.supported_formats.map(format => format.toUpperCase()).join('、') : 'TXT、Markdown'

  const acceptSession = (next: Session) => {
    setSession(next); setConsent(false); setArtifactConsent(false)
    if (!next.artifact) setArtifactText('')
    setCandidateDrafts({}); setExpanded({})
  }

  const mutateBackground = (operation: (signal: AbortSignal) => Promise<unknown>) => {
    return run(async signal => { await operation(signal); return api.getSession(session.id, signal) }, next => { acceptSession(next); void refreshMemories(next.id) }, '正在更新背景…')
  }

  const refreshMemories = useCallback(async (sessionId: string) => {
    try { const result = await api.listMemories(sessionId); setMemories(Array.isArray(result.items) ? result.items : []) } catch { /* memory list is optional */ }
  }, [])

  useEffect(() => {
    let alive = true
    Promise.all([api.getConfig(), api.createSession()]).then(([nextConfig, nextSession]) => {
      if (!alive) return
      setConfig(nextConfig); setSession(nextSession); setLoading(false); refreshMemories(nextSession.id)
    }).catch((reason: unknown) => { if (alive) { setError(reason instanceof Error ? reason.message : '无法连接本地服务'); setLoading(false) } })
    return () => { alive = false; controller.current?.abort() }
  }, [refreshMemories])

  const run = async <T,>(operation: (signal: AbortSignal) => Promise<T>, apply: (value: T) => void, busyMessage: string): Promise<boolean> => {
    const id = ++requestId.current
    controller.current?.abort()
    const nextController = new AbortController()
    controller.current = nextController
    setError(''); setStatus(busyMessage); setPending(true); setConsent(false); setArtifactConsent(false)
    try {
      const value = await operation(nextController.signal)
      if (id === requestId.current) { apply(value); setStatus(''); setPending(false); return true }
    } catch (reason: unknown) {
      if (id !== requestId.current || (reason instanceof DOMException && reason.name === 'AbortError')) return false
      setStatus(''); setPending(false); setError(reason instanceof Error ? reason.message : '请求失败')
      if (session.id) { try { const fresh = await api.getSession(session.id); if (id === requestId.current) acceptSession(fresh) } catch { /* keep the original failure */ } }
    }
    return false
  }

  const onUpload = async (file?: File) => {
    if (!file || !session.id) return
    if (session.ended) return
    setUploading(true); setPending(false); setConsent(false); setError(''); setStatus('正在读取文件…')
    const id = ++requestId.current
    controller.current?.abort()
    const uploadController = new AbortController(); controller.current = uploadController
    try {
      const next = await api.uploadDocument(session.id, file, uploadController.signal)
      if (id !== requestId.current) return
      setSession(next); setArtifactText(''); setConsent(false); setArtifactConsent(false); setStatus('文件已读入本次会话，尚未发送给模型。'); await refreshMemories(next.id)
    } catch (reason: unknown) { if (id === requestId.current) { setError(reason instanceof Error ? reason.message : '文件读取失败'); setStatus('') } }
    finally { if (id === requestId.current) setUploading(false) }
  }

  const interpret = () => {
    if (!consent || !session.document) return
    void run(signal => api.interpret(session, signal), next => { setSession(next); setConsent(false); setArtifactConsent(false) }, '正在请求模型解读…')
  }

  const addFact = (suppliedText?: string) => {
    const text = (suppliedText ?? factDraft).trim()
    if (!text) return Promise.resolve(false)
    return run(signal => api.addFact(session, text, '用户本次输入', signal), next => { acceptSession(next); setFactDraft('') }, '正在加入本次确认背景…')
  }

  const generateArtifact = () => {
    if (!artifactConsent) return
    void run(signal => api.createArtifact(session, goal === '按我的目标起草一段文字' ? customGoal.trim() : goal, signal), next => { setSession(next); setArtifactText(next.artifact?.text ?? ''); setArtifactConsent(false) }, '正在生成可编辑产物…')
  }

  const saveArtifact = () => {
    void run(signal => api.patchArtifact(session, artifactText, signal), next => setSession(next), '正在保存编辑…')
  }

  const downloadArtifact = async () => {
    if (!session.artifact) return
    const id = ++requestId.current
    controller.current?.abort()
    const exportController = new AbortController(); controller.current = exportController
    setError(''); setStatus('正在准备下载…')
    try {
      const saved = await api.patchArtifact(session, artifactText, exportController.signal)
      if (id !== requestId.current) return
      setSession(saved)
      const blob = await api.exportArtifact(saved, exportController.signal)
      if (id !== requestId.current) return
      const url = URL.createObjectURL(blob)
      const anchor = document.createElement('a'); anchor.href = url; anchor.download = '文启-可编辑产物.md'; document.body.appendChild(anchor); anchor.click(); anchor.remove(); URL.revokeObjectURL(url)
      setStatus('已下载当前编辑版本。')
    } catch (reason: unknown) {
      if (id !== requestId.current || (reason instanceof DOMException && reason.name === 'AbortError')) return
      setError(reason instanceof Error ? reason.message : '导出失败'); setStatus('')
    }
  }

  const reset = async () => {
    if (!session.id) return
    controller.current?.abort(); const id = ++requestId.current; setPending(false); setUploading(false); setFactDraft(''); setQuestionAnswer(''); setCustomGoal(''); setSelectedQuestion(null); setClearBackgroundEpoch(value => value + 1)
    try { const next = await api.resetSession(session.id); if (id !== requestId.current) return; acceptSession(next); setConsent(false); setArtifactText(''); setError(''); setStatus('本次会话已清空。'); await refreshMemories(next.id) }
    catch (reason: unknown) { if (id === requestId.current) setError(reason instanceof Error ? reason.message : '清空失败') }
  }

  const end = async () => {
    if (!session.id) return
    controller.current?.abort(); const id = ++requestId.current; setPending(false); setUploading(false); setFactDraft(''); setQuestionAnswer(''); setCustomGoal(''); setSelectedQuestion(null); setClearBackgroundEpoch(value => value + 1)
    try { const next = await api.endSession(session.id); if (id !== requestId.current) return; acceptSession(next); setArtifactText(''); setStatus('本次理解已结束，临时内容已清除。') }
    catch (reason: unknown) { if (id === requestId.current) setError(reason instanceof Error ? reason.message : '结束失败') }
  }

  const cancel = async () => {
    controller.current?.abort(); const id = ++requestId.current; setPending(false); setUploading(false)
    if (session.id) { try { const next = await api.cancelSession(session.id); if (id !== requestId.current) return; acceptSession(next); setStatus('已取消当前请求。') } catch { if (id === requestId.current) setStatus('本地已取消请求；服务端取消未确认。') } }
  }

  const addCandidate = (text: string) => {
    void run(signal => api.addFact(session, text, '模型候选；用户确认用于本次', signal), next => acceptSession(next), '正在确认背景…')
  }

  if (loading) return <main className="loading-shell"><LoaderCircle className="spin" aria-hidden="true" /><span>正在连接本机服务…</span></main>

  return <div className="app-shell">
    <aside className="brand-rail">
      <div className="brand-mark" aria-label="文启"><span>文</span><span>启</span></div>
      <div className="rail-copy"><p className="eyebrow">FILEACTION / 个人工作台</p><h1>把收到的文件，变成下一步。</h1><p>文启先帮你看懂当下，再由你决定是否行动。</p></div>
      <div className="rail-foot"><ShieldCheck size={16} aria-hidden="true" /> <span>本机会话 · 默认不保存</span></div>
    </aside>
    <main className="workspace">
      <header className="topbar"><div><span className="eyebrow">个人 MVP · 文件解读</span><p className="topline">每一步都由你确认</p></div><div className="top-actions"><button className="quiet-button" onClick={() => void reset()} disabled={!session.document && !session.reading && !pending}><RotateCcw size={16} />重置</button><button className="quiet-button" onClick={() => void end()} disabled={!session.id}><X size={16} />结束本次</button></div></header>
      {error && <div role="alert" className="error-banner"><span>{error}</span><button aria-label="关闭错误" onClick={() => setError('')}><X size={16} /></button></div>}
      {status && <div className="status-line" aria-live="polite">{status}{pending && <button onClick={() => void cancel()}>取消</button>}</div>}
      <section className="content-grid">{session.ended && <div className="ended-banner"><p>本次已结束，文件、背景和解读已清空。</p><button className="primary-button" onClick={() => void run(signal => api.createSession(signal), next => { acceptSession(next); setStatus("新的本次会话已开始。") }, "正在开始新会话…")}>开始新会话</button></div>}
        <div className="primary-column">
          {!session.document && <section className="hero-panel"><div className="hero-kicker"><Sparkles size={18} />从一份文件开始</div><h2>收到文件，先交给文启。</h2><p className="hero-lede">不需要先填写档案。上传一份通知、材料或说明，我们先把与你有关的部分理清楚。</p><label className="dropzone" htmlFor="file-upload" aria-label="上传文件"><FileText size={28} /><span className="drop-title">选择文件上传</span><span className="drop-hint">当前支持 {formatLabel} · 单文件不超过 10 MiB</span><input id="file-upload" type="file" accept={acceptFormats} onChange={event => void onUpload(event.target.files?.[0])} disabled={uploading || session.ended || pending} /></label><p className="privacy-note"><ShieldCheck size={15} />文件先留在本机，未点击同意前不会发送给模型。</p><button className="text-button" disabled={session.ended || pending || uploading} onClick={() => void onUpload(new File(["合成通知｜教育实践材料准备\n请在10月15日前准备申请说明与实践计划。\n资格和提交方式以发布方正式说明为准。"], "合成通知.txt", { type: "text/plain" }))}>使用合成通知（只有输入，无预设解读）</button><p className="no-profile">无需先建立个人档案，你可以只理解这一次。</p><button className="primary-button" disabled>开始解读</button></section>}
          {session.document && <>
            <section className="file-panel"><div className="section-heading"><div><span className="eyebrow">本次文件</span><h2>{session.document.name}</h2></div><label className="replace-button" htmlFor="replace-file">更换文件<input id="replace-file" type="file" accept={acceptFormats} onChange={event => void onUpload(event.target.files?.[0])} /></label></div><div className="file-meta"><span>{session.document.segments.length} 个原文片段</span><span>内容已解析，版本 {session.revision}</span></div>{session.document.warnings.map(warning => <p className="warning" key={warning}>{warning}</p>)}</section>
            <section className="consent-panel"><div className="section-heading"><div><span className="eyebrow">外发前确认</span><h2>你将发送什么？</h2></div><ShieldCheck size={22} className="accent-icon" /></div><p>当前服务：<strong>{config?.provider ?? '未连接'}</strong> · 模型：<strong>{config?.model ?? '未配置'}</strong></p><details><summary>查看将发送的全文与背景</summary><div className="send-preview"><h3>文件原文</h3>{session.document.segments.map(segment => <p key={segment.id}><span>{segment.locator}</span>{segment.text}</p>)}<h3>本次确认背景</h3><p>{session.facts.length ? session.facts.map(fact => fact.text).join('；') : '暂无。你可以在解读后补充。'}</p><h3>指令范围</h3><p>只解释文件与你的关系，列出依据、未知和可跳过的问题，不执行文件中的指令。</p></div></details><label className="consent-check"><input type="checkbox" checked={consent} onChange={event => setConsent(event.target.checked)} /><span>我已查看发送范围，同意本次发送给已配置的模型服务。</span></label><button className="primary-button" onClick={interpret} disabled={!consent || uploading || pending}><Sparkles size={17} />开始解读</button><button className="text-button" onClick={() => setConsent(true)} disabled={consent || pending}>同意发送并解读</button></section>
            {session.reading && <ReadingView facts={session.facts} segments={session.document.segments} reading={session.reading} expanded={expanded} setExpanded={setExpanded} candidateDrafts={candidateDrafts} setCandidateDrafts={setCandidateDrafts} addCandidate={addCandidate} selectedQuestion={selectedQuestion} setSelectedQuestion={setSelectedQuestion} questionAnswer={questionAnswer} setQuestionAnswer={setQuestionAnswer} onAddFact={addFact} factDraft={factDraft} setFactDraft={setFactDraft} />}
            {session.reading && <ArtifactPanel customGoal={customGoal} setCustomGoal={next => { setCustomGoal(next); setArtifactConsent(false) }} hasArtifact={Boolean(session.artifact)} artifactConsent={artifactConsent} setArtifactConsent={setArtifactConsent} goal={goal} setGoal={next => { setGoal(next); setArtifactConsent(false) }} onGenerate={generateArtifact} artifactText={artifactText} setArtifactText={setArtifactText} onSave={saveArtifact} onDownload={downloadArtifact} />}
          </>}
        </div>
        <aside className="evidence-column"><section className="evidence-panel"><div className="section-heading"><div><span className="eyebrow">原文依据</span><h2>随时回看</h2></div><FileText size={20} /></div>{session.document ? <div className="segments">{session.document.segments.map(segment => <div className="segment" key={segment.id}><span className="locator">{segment.locator}</span><p>{segment.text}</p></div>)}</div> : <div className="empty-evidence"><FileText size={24} /><p>上传后，这里会保留可核对的原文片段。</p></div>}</section><MemoryPanel clearEpoch={clearBackgroundEpoch} onAddFact={addFact} onSave={factId => mutateBackground(signal => api.saveMemory(session, factId, signal))} onPatchFact={(factId, text) => mutateBackground(signal => api.patchFact(session, factId, text, signal))} onDeleteFact={factId => mutateBackground(signal => api.deleteFact(session, factId, signal))} onPatchMemory={(memoryId, patch) => mutateBackground(signal => api.patchMemory(session.id, memoryId, patch, signal))} onDeleteMemory={memoryId => mutateBackground(signal => api.deleteMemory(session.id, memoryId, signal))} session={session} memories={memories} refresh={() => refreshMemories(session.id)} onUse={memoryId => void run(signal => api.useMemory(session, memoryId, signal), next => acceptSession(next), '正在复用背景…')} /></aside>
      </section>
    </main>
  </div>
}

function ReadingView(props: { facts: Fact[]; segments: { id: string; locator: string; text: string }[]; reading: Reading; expanded: Record<string, boolean>; setExpanded: Dispatch<SetStateAction<Record<string, boolean>>>; candidateDrafts: Record<number, boolean>; setCandidateDrafts: Dispatch<SetStateAction<Record<number, boolean>>>; addCandidate: (text: string) => void; selectedQuestion: number | null; setSelectedQuestion: (value: number | null) => void; questionAnswer: string; setQuestionAnswer: (value: string) => void; onAddFact: (text?: string) => void; factDraft: string; setFactDraft: (value: string) => void }) {
  const [candidateTexts, setCandidateTexts] = useState<Record<number, string>>({})
  const { reading, facts, segments, expanded, setExpanded, candidateDrafts, setCandidateDrafts, addCandidate, selectedQuestion, setSelectedQuestion, questionAnswer, setQuestionAnswer, onAddFact, factDraft, setFactDraft } = props
  return <section className="reading-panel"><div className="section-heading"><div><span className="eyebrow">解读结果</span><h2>这份文件与你有关的部分</h2></div><span className="result-badge"><Check size={14} />可核对</span></div><div className="reading-items">{reading.items.map((item, index) => { const key = `${index}-${item.title}`; return <article className="reading-item" key={key}><div className="item-label"><span className={`kind kind-${item.kind}`}>{kindLabel(item.kind)}</span><h3>{item.title}</h3></div><p>{item.meaning}</p>{(item.citations.length > 0 || item.fact_ids.length > 0) && <button className="citation-toggle" onClick={() => setExpanded(current => ({ ...current, [key]: !current[key] }))}>{expanded[key] ? <ChevronUp size={15} /> : <ChevronDown size={15} />}查看依据</button>}{expanded[key] && <div className="citations">{item.citations.map(citation => <blockquote key={citation.segment_id}>“{citation.quote}” <span>· {segments.find(segment => segment.id === citation.segment_id)?.locator ?? "位置未知"}</span></blockquote>)}{item.fact_ids.map(id => <p key={id}>已确认背景：{facts.find(fact => fact.id === id)?.text ?? "背景已失效"}</p>)}</div>}</article> })}</div>{reading.unknowns.length > 0 && <div className="unknown-box"><strong>目前还不能确认</strong>{reading.unknowns.map(unknown => <p key={unknown}>{unknown}</p>)}</div>}{reading.questions.length > 0 && <div className="questions-box"><div className="box-title">需要你补充吗？<span>可以跳过，不影响本次理解</span></div>{reading.questions.map((question, index) => <div className="question-row" key={question.question}><div><strong>{question.question}</strong><small>{question.reason}</small></div>{selectedQuestion === index ? <div className="question-answer"><textarea aria-label="补充回答" value={questionAnswer} onChange={event => setQuestionAnswer(event.target.value)} placeholder="写下你的情况，也可以留空" /><div><button className="secondary-button" onClick={() => { if (questionAnswer.trim()) { onAddFact(questionAnswer) };  }}>确认用于本次</button><button className="text-button" onClick={() => setSelectedQuestion(null)}>跳过</button></div></div> : <button className="secondary-button" onClick={() => setSelectedQuestion(index)}>补充</button>}</div>)}</div>}{reading.candidates.length > 0 && <div className="candidate-box"><div className="box-title">可能适合保留的背景<span>只有你确认后才会用于本次</span></div>{reading.candidates.map((candidate, index) => <label className="candidate-row" key={candidate.text}><input type="checkbox" checked={Boolean(candidateDrafts[index])} onChange={event => setCandidateDrafts(current => ({ ...current, [index]: event.target.checked }))} /><span><textarea aria-label="编辑候选背景" value={candidateTexts[index] ?? candidate.text} onChange={event => setCandidateTexts(previous => ({ ...previous, [index]: event.target.value }))} />{candidate.source_segment_ids.map(id => { const source = segments.find(segment => segment.id === id); return <small key={id}>来源：{source?.locator ?? "未知位置"} · {source?.text ?? "引用已失效"}</small> })}</span><button type="button" className="link-button" onClick={event => { event.preventDefault(); addCandidate(candidateTexts[index] ?? candidate.text) }}>确认用于本次</button></label>)}</div>}<div className="fact-input"><label htmlFor="fact-draft">补充或纠正本次背景</label><div><input id="fact-draft" value={factDraft} onChange={event => setFactDraft(event.target.value)} placeholder="例如：我目前在准备教育实习" /><button className="secondary-button" onClick={() => onAddFact()} disabled={!factDraft.trim()}>确认用于本次</button></div><small>本次确认不等于长期保存。</small></div></section>
}

function ArtifactPanel(props: { customGoal: string; setCustomGoal: (value: string) => void; hasArtifact: boolean; artifactConsent: boolean; setArtifactConsent: (value: boolean) => void; goal: string; setGoal: (value: string) => void; onGenerate: () => void; artifactText: string; setArtifactText: (value: string) => void; onSave: () => void; onDownload: () => void }) {
  const { customGoal, setCustomGoal, hasArtifact, artifactConsent, setArtifactConsent, goal, setGoal, onGenerate, artifactText, setArtifactText, onSave, onDownload } = props
  return <section className="artifact-panel"><div className="section-heading"><div><span className="eyebrow">可选行动</span><h2>把理解变成一个可编辑产物</h2></div><ArrowRight size={21} /></div><p>只有你主动选择方向后，文启才会起草。内容仍由你核对、修改和决定是否下载。</p><div className="goal-row"><label htmlFor="goal">我想先</label><select id="goal" value={goal} onChange={event => setGoal(event.target.value)}><option>核实这份文件中的要求</option><option>准备一份行动清单</option><option>按我的目标起草一段文字</option></select>{goal === "按我的目标起草一段文字" && <input aria-label="自定义起草目标" value={customGoal} onChange={event => setCustomGoal(event.target.value)} placeholder="写下你想得到的具体产物" />}<label className="consent-check"><input type="checkbox" aria-label="同意本次起草" checked={artifactConsent} onChange={event => setArtifactConsent(event.target.checked)} />同意将当前文件、背景和目标发送给模型起草</label><button className="primary-button" onClick={onGenerate} disabled={!artifactConsent || (goal === "按我的目标起草一段文字" && !customGoal.trim())}><Sparkles size={17} />生成可编辑产物</button></div>{hasArtifact && <div className="editor-wrap"><label htmlFor="artifact-editor">产物正文</label><textarea id="artifact-editor" aria-label="产物正文" value={artifactText} onChange={event => setArtifactText(event.target.value)} placeholder="生成后将在这里出现可编辑正文" /><div className="editor-actions"><button className="secondary-button" onClick={onSave}>保存编辑</button><button className="primary-button" onClick={onDownload}><Download size={17} />下载 Markdown</button></div></div>}</section>
}

type BackgroundProps = {
  clearEpoch: number
  session: Session
  memories: Memory[]
  refresh: () => void
  onUse: (id: string) => void
  onAddFact: (text: string) => Promise<boolean>
  onSave: (id: string) => void
  onPatchFact: (id: string, text: string) => Promise<boolean>
  onDeleteFact: (id: string) => void
  onPatchMemory: (id: string, patch: { text?: string; active?: boolean }) => Promise<boolean>
  onDeleteMemory: (id: string) => void
}

function MemoryPanel(props: BackgroundProps) {
  const [draft, setDraft] = useState('')
  const [editing, setEditing] = useState<string | null>(null)
  const [editText, setEditText] = useState('')
  const [deleteId, setDeleteId] = useState<string | null>(null)
  useEffect(() => { setDraft(''); setEditing(null); setEditText(''); setDeleteId(null) }, [props.clearEpoch])
  const startEdit = (id: string, text: string) => { setEditing(id); setEditText(text) }
  return <section className="memory-panel">
    <div className="section-heading"><div><span className="eyebrow">本次背景与保留</span><h2>由你决定使用什么</h2></div></div>
    <p className="memory-copy">确认属实、回答问题和生成解读，都不会自动保存。每次复用也由你选择。</p>
    {!props.session.ended && <div className="fact-input"><label htmlFor="background-input">可选本次背景</label><textarea id="background-input" value={draft} onChange={event => setDraft(event.target.value)} placeholder="不填也可以开始" /><button className="secondary-button" disabled={!draft.trim()} onClick={async () => { if (await props.onAddFact(draft)) setDraft('') }}>确认并用于本次</button></div>}
    <h3>本次已确认背景</h3>
    {props.session.facts.length === 0 && <p className="muted">暂未提供背景。</p>}
    {props.session.facts.map(fact => <div className="memory-row" key={fact.id} data-testid="confirmed-fact">
      {editing === fact.id ? <><textarea aria-label="编辑本次背景" value={editText} onChange={event => setEditText(event.target.value)} /><button className="secondary-button" onClick={async () => { if (await props.onPatchFact(fact.id, editText)) setEditing(null) }} disabled={!editText.trim()}>保存本次背景修改</button></> : <><p>{fact.text}</p><small>来源：{fact.source} · 版本 {fact.version}</small><div className="background-actions"><button className="link-button" onClick={() => startEdit(fact.id, fact.text)}>编辑本次背景</button><button className="link-button" onClick={() => props.onDeleteFact(fact.id)}>移出本次</button><button className="secondary-button" onClick={() => props.onSave(fact.id)} disabled={Boolean(fact.memory_id)}>保留供下次使用</button></div></>}
    </div>)}
    <h3>本机保留背景</h3>
    {props.memories.length === 0 && <p className="muted">目前没有已保存的背景。</p>}
    <div className="memory-list">{props.memories.map(memory => <div className="memory-row" key={memory.id} data-testid="saved-memory">
      {editing === memory.id ? <><textarea aria-label="编辑保留背景" value={editText} onChange={event => setEditText(event.target.value)} /><button className="secondary-button" disabled={!editText.trim()} onClick={async () => { if (await props.onPatchMemory(memory.id, { text: editText })) setEditing(null) }}>保存保留背景修改</button></> : <><p>{memory.text}</p><small>来源：{memory.source} · 版本 {memory.version} · {memory.active ? '启用中' : '已停用'}</small><div className="background-actions"><button className="link-button" disabled={!memory.active || props.session.ended} onClick={() => props.onUse(memory.id)}>本次复用</button><button className="link-button" onClick={() => startEdit(memory.id, memory.text)}>编辑保留背景</button><button className="link-button" onClick={() => props.onPatchMemory(memory.id, { active: !memory.active })}>{memory.active ? '停用' : '启用'}</button><button className="link-button" onClick={() => setDeleteId(memory.id)}>删除</button></div></>}
      {deleteId === memory.id && <div className="delete-confirm" role="group" aria-label="删除背景确认"><p>确认删除这条本机背景？已下载的副本和此前发送到模型的数据无法撤回。</p><button className="secondary-button" onClick={() => { props.onDeleteMemory(memory.id); setDeleteId(null) }}>确认删除</button><button className="text-button" onClick={() => setDeleteId(null)}>取消删除</button></div>}
    </div>)}</div>
    <button className="text-button" onClick={props.refresh}>刷新背景列表</button>
  </section>
}
