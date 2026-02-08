import type { RagDocumentInput, RagQueryFilters, RagQueryResult, RagService, RagUpsertResult, RagDeleteResult, RagError } from '../types.ts'
import type { EmbeddingsService } from '../../embeddings/types.ts'
import type { EmbeddingsHealth } from '../../embeddings/ollamaEmbeddings.ts'

import type { SqliteDb } from './db.ts'
import { chunkText } from '../chunking.ts'
import { cosineSimilarity } from '../similarity.ts'

export type SqliteRagConfig = {
  chunkSizeChars: number
  chunkOverlapChars: number
  maxTextCharsPerDoc: number
  maxQueryChars: number
  candidateLimit: number
}

function truncateWithMarker(input: string, maxChars: number): string {
  const text = String(input ?? '')
  if (!Number.isFinite(maxChars) || maxChars <= 0) return text
  if (text.length <= maxChars) return text

  const marker = `\n[TRUNCATED to ${Math.floor(maxChars)} chars]`
  const keep = Math.max(0, maxChars - marker.length)
  return text.slice(0, keep) + marker
}

function toRagError(error: unknown): RagError {
  if (error && typeof error === 'object') {
    const kind = (error as { kind?: unknown }).kind
    const message = (error as { message?: unknown }).message
    if (typeof kind === 'string' && typeof message === 'string') return { kind, message }
  }

  if (error instanceof Error) {
    return { kind: 'unknown', message: error.message }
  }

  return { kind: 'unknown', message: 'Unknown error' }
}

function safeJsonStringify(value: unknown): string {
  try {
    return JSON.stringify(value)
  } catch {
    return '{}'
  }
}

function safeJsonParseObject(value: unknown): Record<string, unknown> | undefined {
  if (typeof value !== 'string' || !value) return undefined
  try {
    const parsed: unknown = JSON.parse(value)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return undefined
    return parsed as Record<string, unknown>
  } catch {
    return undefined
  }
}

function buildWhereFromFilters(filters?: RagQueryFilters): { whereSql: string; params: unknown[] } {
  const clauses: string[] = []
  const params: unknown[] = []

  if (filters?.source) {
    clauses.push('source = ?')
    params.push(filters.source)
  }
  if (filters?.sourceId) {
    clauses.push('sourceId = ?')
    params.push(filters.sourceId)
  }
  if (filters?.mimeType) {
    clauses.push('mimeType = ?')
    params.push(filters.mimeType)
  }

  if (!clauses.length) return { whereSql: '', params }
  return { whereSql: `WHERE ${clauses.join(' AND ')}`, params }
}

function normalizeTopK(topK: unknown): number {
  const n = typeof topK === 'number' ? topK : 5
  if (!Number.isFinite(n) || n <= 0) return 5
  return Math.min(50, Math.floor(n))
}

export function createSqliteRagService({
  db,
  embeddings,
  config,
  embeddingsHealth,
}: {
  db: SqliteDb
  embeddings: EmbeddingsService
  config: SqliteRagConfig
  embeddingsHealth: EmbeddingsHealth
}): RagService {
  const insertStmt = db.prepare(
    'INSERT OR REPLACE INTO rag_chunks (id, docId, source, sourceId, title, mimeType, createdAt, chunkIndex, text, metaJson, embeddingJson) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
  )

  return {
    async upsertDocuments(docs: RagDocumentInput[]): Promise<RagUpsertResult> {
      if (!embeddingsHealth.ok) {
        return { ok: false, upserted: 0, error: embeddingsHealth.error }
      }

      if (!Array.isArray(docs) || docs.length === 0) {
        return { ok: true, upserted: 0 }
      }

      let upserted = 0

      try {
        for (const doc of docs) {
          const docId = String(doc.id)
          const text = truncateWithMarker(String(doc.text ?? ''), config.maxTextCharsPerDoc)

          const chunks = chunkText(text, config.chunkSizeChars, config.chunkOverlapChars)
          db.prepare('DELETE FROM rag_chunks WHERE docId = ?').run(docId)
          for (const chunk of chunks) {
            const embedding = await embeddings.embedText(chunk.text)
            const chunkId = `${docId}:${chunk.chunkIndex}`
            const metaJson = doc.meta ? safeJsonStringify(doc.meta) : ''

            insertStmt.run(
              chunkId,
              docId,
              doc.source,
              doc.sourceId,
              doc.title || '',
              doc.mimeType || '',
              doc.createdAt,
              chunk.chunkIndex,
              chunk.text,
              metaJson,
              JSON.stringify(embedding),
            )
            upserted += 1
          }
        }

        return { ok: true, upserted }
      } catch (error: unknown) {
        return { ok: false, upserted, error: toRagError(error) }
      }
    },

    async query(query: string, topK?: number, filters?: RagQueryFilters): Promise<RagQueryResult> {
      if (!embeddingsHealth.ok) {
        return { ok: false, query, results: [], error: embeddingsHealth.error }
      }

      const q = truncateWithMarker(String(query ?? ''), config.maxQueryChars)
      const k = normalizeTopK(topK)

      if (!q.trim()) {
        return { ok: false, query: q, results: [], error: { kind: 'invalid_input', message: 'Query is empty' } }
      }

      try {
        const queryVec = await embeddings.embedText(q)

        const { whereSql, params } = buildWhereFromFilters(filters)
        const selectSql = `SELECT id, source, sourceId, title, text, metaJson, embeddingJson, createdAt FROM rag_chunks ${whereSql} ORDER BY createdAt DESC LIMIT ?`
        const rows = db.prepare(selectSql).all(...params, config.candidateLimit)

        let candidates = rows
        if (whereSql && candidates.length === 0) {
          const fallbackSql =
            'SELECT id, source, sourceId, title, text, metaJson, embeddingJson, createdAt FROM rag_chunks ORDER BY createdAt DESC LIMIT ?'
          candidates = db.prepare(fallbackSql).all(config.candidateLimit)
        }

        type Scored = {
          id: string
          score: number
          source: 'upload'
          sourceId: string
          title?: string | undefined
          text: string
          meta?: Record<string, unknown> | undefined
        }

        const scored: Scored[] = []
        for (const row of candidates) {
          if (!row || typeof row !== 'object') continue
          const id = String((row as { id?: unknown }).id ?? '')
          const source = String((row as { source?: unknown }).source ?? '')
          const sourceId = String((row as { sourceId?: unknown }).sourceId ?? '')
          const titleRaw = (row as { title?: unknown }).title
          const textRaw = (row as { text?: unknown }).text
          const metaJson = (row as { metaJson?: unknown }).metaJson
          const embeddingJson = (row as { embeddingJson?: unknown }).embeddingJson

          if (!id || source !== 'upload' || !sourceId) continue
          const textVal = typeof textRaw === 'string' ? textRaw : ''

          let vec: unknown = null
          try {
            vec = typeof embeddingJson === 'string' ? JSON.parse(embeddingJson) : null
          } catch {
            vec = null
          }

          const vecArr = Array.isArray(vec) ? (vec as unknown[]) : []
          const numVec = vecArr.every((n) => typeof n === 'number') ? (vecArr as number[]) : []
          const score = cosineSimilarity(queryVec, numVec)

          scored.push({
            id,
            score,
            source: 'upload',
            sourceId,
            title: typeof titleRaw === 'string' && titleRaw ? titleRaw : undefined,
            text: textVal,
            meta: safeJsonParseObject(metaJson),
          })
        }

        scored.sort((a, b) => b.score - a.score)
        const results = scored.slice(0, k).map((s) => ({
          id: s.id,
          score: s.score,
          source: s.source,
          sourceId: s.sourceId,
          ...(s.title ? { title: s.title } : {}),
          excerpt: s.text.slice(0, 240),
          ...(s.meta ? { meta: s.meta } : {}),
        }))

        return { ok: true, query: q, results }
      } catch (error: unknown) {
        return { ok: false, query: q, results: [], error: toRagError(error) }
      }
    },

    async deleteDocuments(ids: string[]): Promise<RagDeleteResult> {
      if (!embeddingsHealth.ok) {
        return { ok: false, deleted: 0, error: embeddingsHealth.error }
      }

      if (!Array.isArray(ids) || ids.length === 0) {
        return { ok: true, deleted: 0 }
      }

      try {
        const placeholders = ids.map(() => '?').join(',')
        const stmt = db.prepare(`DELETE FROM rag_chunks WHERE docId IN (${placeholders})`)
        const res = stmt.run(...ids.map((id) => String(id)))
        return { ok: true, deleted: Number(res.changes) || 0 }
      } catch (error: unknown) {
        return { ok: false, deleted: 0, error: toRagError(error) }
      }
    },
  }
}
