import type { Config, Memory, Session } from './types'

export class ApiError extends Error {
  status: number
  constructor(message: string, status = 500) {
    super(message)
    this.name = 'ApiError'
    this.status = status
  }
}

async function readResponse<T>(response: Response): Promise<T> {
  if (!response.ok) {
    let detail = `服务请求失败（${response.status}）`
    try {
      const body = await response.json() as { detail?: string }
      if (body.detail) detail = body.detail
    } catch {
      // Keep the status-based error when the service did not return JSON.
    }
    throw new ApiError(detail, response.status)
  }
  return response.json() as Promise<T>
}

function sessionHeaders(sessionId: string, json = false): HeadersInit {
  return json
    ? { 'Content-Type': 'application/json', 'X-Session-ID': sessionId }
    : { 'X-Session-ID': sessionId }
}

export async function getConfig(signal?: AbortSignal): Promise<Config> {
  const response = await fetch('/api/config', { signal })
  return readResponse<Config>(response)
}

export async function createSession(signal?: AbortSignal): Promise<Session> {
  const response = await fetch('/api/session', { method: 'POST', signal })
  return readResponse<Session>(response)
}

export async function getSession(sessionId: string, signal?: AbortSignal): Promise<Session> {
  return readResponse<Session>(await fetch('/api/session', { headers: sessionHeaders(sessionId), signal }))
}

export async function uploadDocument(sessionId: string, file: File, signal?: AbortSignal): Promise<Session> {
  const response = await fetch(`/api/document?filename=${encodeURIComponent(file.name)}`, {
    method: 'POST', headers: { ...sessionHeaders(sessionId), 'Content-Type': 'application/octet-stream' },
    body: file, signal,
  })
  return readResponse<Session>(response)
}

export async function interpret(session: Session, signal?: AbortSignal): Promise<Session> {
  const response = await fetch('/api/interpret', {
    method: 'POST', headers: sessionHeaders(session.id, true),
    body: JSON.stringify({ revision: session.revision, consent: true }), signal,
  })
  return readResponse<Session>(response)
}

export async function addFact(session: Session, text: string, source?: string, signal?: AbortSignal): Promise<Session> {
  const response = await fetch('/api/facts', {
    method: 'POST', headers: sessionHeaders(session.id, true),
    body: JSON.stringify({ text, ...(source ? { source } : {}) }), signal,
  })
  return readResponse<Session>(response)
}

export async function patchFact(session: Session, factId: string, text: string, signal?: AbortSignal): Promise<Session> {
  const response = await fetch(`/api/facts/${encodeURIComponent(factId)}`, {
    method: 'PATCH', headers: sessionHeaders(session.id, true), body: JSON.stringify({ text }), signal,
  })
  return readResponse<Session>(response)
}

export async function deleteFact(session: Session, factId: string, signal?: AbortSignal): Promise<Session> {
  const response = await fetch(`/api/facts/${encodeURIComponent(factId)}`, { method: 'DELETE', headers: sessionHeaders(session.id), signal })
  return readResponse<Session>(response)
}

export async function listMemories(sessionId: string, signal?: AbortSignal): Promise<{ items: Memory[] }> {
  const response = await fetch('/api/memories', { headers: sessionHeaders(sessionId), signal })
  return readResponse<{ items: Memory[] }>(response)
}

export async function saveMemory(session: Session, factId: string, signal?: AbortSignal): Promise<Memory> {
  const response = await fetch('/api/memories', {
    method: 'POST', headers: sessionHeaders(session.id, true), body: JSON.stringify({ fact_id: factId, consent: true }), signal,
  })
  return readResponse<Memory>(response)
}

export async function patchMemory(sessionId: string, memoryId: string, patch: { text?: string; active?: boolean }, signal?: AbortSignal): Promise<Memory> {
  const response = await fetch(`/api/memories/${encodeURIComponent(memoryId)}`, {
    method: 'PATCH', headers: sessionHeaders(sessionId, true), body: JSON.stringify(patch), signal,
  })
  return readResponse<Memory>(response)
}

export async function deleteMemory(sessionId: string, memoryId: string, signal?: AbortSignal): Promise<{ deleted: boolean }> {
  const response = await fetch(`/api/memories/${encodeURIComponent(memoryId)}?confirmed=true`, { method: 'DELETE', headers: sessionHeaders(sessionId), signal })
  return readResponse<{ deleted: boolean }>(response)
}

export async function useMemory(session: Session, memoryId: string, signal?: AbortSignal): Promise<Session> {
  const response = await fetch(`/api/memories/${encodeURIComponent(memoryId)}/use`, { method: 'POST', headers: sessionHeaders(session.id), signal })
  return readResponse<Session>(response)
}

export async function createArtifact(session: Session, goal: string, signal?: AbortSignal): Promise<Session> {
  const response = await fetch('/api/artifact', {
    method: 'POST', headers: sessionHeaders(session.id, true), body: JSON.stringify({ revision: session.revision, consent: true, goal }), signal,
  })
  return readResponse<Session>(response)
}

export async function patchArtifact(session: Session, text: string, signal?: AbortSignal): Promise<Session> {
  const response = await fetch('/api/artifact', {
    method: 'PATCH', headers: sessionHeaders(session.id, true), body: JSON.stringify({ revision: session.revision, text }), signal,
  })
  return readResponse<Session>(response)
}

export async function exportArtifact(session: Session, signal?: AbortSignal): Promise<Blob> {
  const response = await fetch('/api/export', {
    method: 'POST', headers: sessionHeaders(session.id, true), body: JSON.stringify({ revision: session.revision }), signal,
  })
  if (!response.ok) {
    let detail = `导出失败（${response.status}）`
    try { detail = ((await response.json()) as { detail?: string }).detail ?? detail } catch { /* status is enough */ }
    throw new ApiError(detail, response.status)
  }
  return response.blob()
}

export async function cancelSession(sessionId: string): Promise<Session> {
  const response = await fetch('/api/cancel', { method: 'POST', headers: sessionHeaders(sessionId) })
  return readResponse<Session>(response)
}

export async function resetSession(sessionId: string): Promise<Session> {
  const response = await fetch('/api/reset', { method: 'POST', headers: sessionHeaders(sessionId) })
  return readResponse<Session>(response)
}

export async function endSession(sessionId: string): Promise<Session> {
  const response = await fetch('/api/end', { method: 'POST', headers: sessionHeaders(sessionId) })
  return readResponse<Session>(response)
}
