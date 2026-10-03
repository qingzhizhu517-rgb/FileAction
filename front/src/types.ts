export type Segment = { id: string; locator: string; text: string }

export type DocumentInfo = {
  id: string
  name: string
  hash: string
  segments: Segment[]
  warnings: string[]
}

export type Fact = {
  id: string
  text: string
  source: string
  version: number
  memory_id: string | null
}

export type Citation = { segment_id: string; quote: string }

export type ReadingItem = {
  title: string
  meaning: string
  kind: 'fact' | 'inference' | 'unknown'
  citations: Citation[]
  fact_ids: string[]
}

export type Reading = {
  items: ReadingItem[]
  questions: { question: string; reason: string }[]
  unknowns: string[]
  candidates: { text: string; source_segment_ids: string[] }[]
}

export type Artifact = { text: string; citations: Citation[]; fact_ids: string[] }

export type Session = {
  id: string
  revision: number
  document: DocumentInfo | null
  facts: Fact[]
  reading: Reading | null
  artifact: Artifact | null
  ended: boolean
  busy: boolean
}

export type Memory = {
  id: string
  text: string
  source: string
  version: number
  active: boolean
}

export type Config = {
  configured: boolean
  provider: string | null
  model: string | null
  supported_formats: string[]
  limits: Record<string, number>
}
