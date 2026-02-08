export type RagDocId = string

export interface RagDocumentInput {
  id: RagDocId
  source: 'upload'
  sourceId: string
  title?: string
  text: string
  mimeType?: string
  createdAt: string
  meta?: Record<string, unknown>
}

export interface RagUpsertResult {
  ok: boolean
  upserted: number
  error?: { kind: string; message: string }
}

export interface RagDeleteResult {
  ok: boolean
  deleted: number
  error?: { kind: string; message: string }
}

export interface RagQueryFilters {
  source?: 'upload'
  sourceId?: string
  mimeType?: string
}

export interface RagQueryResultItem {
  id: RagDocId
  score: number
  source: 'upload'
  sourceId: string
  title?: string
  excerpt?: string
  meta?: Record<string, unknown>
}

export interface RagQueryResult {
  ok: boolean
  query: string
  results: RagQueryResultItem[]
  error?: { kind: string; message: string }
}

export interface RagService {
  upsertDocuments(docs: RagDocumentInput[]): Promise<RagUpsertResult>
  deleteDocuments(ids: RagDocId[]): Promise<RagDeleteResult>
  query(query: string, topK?: number, filters?: RagQueryFilters): Promise<RagQueryResult>
}
