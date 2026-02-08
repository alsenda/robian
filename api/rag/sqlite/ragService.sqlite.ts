import type {
  RagDeleteResult,
  RagDocumentInput,
  RagError,
  RagQueryFilters,
  RagQueryResult,
  RagService,
  RagUpsertResult,
} from '../types.ts'
import type { EmbeddingsService } from '../../embeddings/types.ts'

import type { openRagSqliteDb } from './db.ts'
import { chunkText } from '../chunking.ts'
import { cosineSimilarity } from '../similarity.ts'

export type SqliteRagConfig = {
  chunkSizeChars: number
  overlapChars: number
  maxDocChars: number
  maxQueryChars: number
  candidateLimit: number
  excerptChars: number
}

function truncateText(input: string, maxChars: number): string {
  const text = String(input ?? '')
  if (!Number.isFinite(maxChars) || maxChars <= 0) return text
  const cap = Math.floor(maxChars)
  if (text.length <= cap) return text
  return text.slice(0, cap)
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

function normalizeTopK(topK: unknown): number {
  const n = typeof topK === 'number' ? topK : 5
  if (!Number.isFinite(n) || n <= 0) return 5
  return Math.floor(n)
}

export function createSqliteRagService({
  db,
  embeddings,
  config,
}: {
  db: ReturnType<typeof openRagSqliteDb>
  embeddings: EmbeddingsService
  config: SqliteRagConfig
}): RagService {
  const excerptChars =
    Number.isFinite(config.excerptChars) && config.excerptChars > 0
      ? Math.floor(config.excerptChars)
      : 240

  return {
    async upsertDocuments(docs: RagDocumentInput[]): Promise<RagUpsertResult> {
      if (!Array.isArray(docs) || docs.length === 0) {
        return { ok: true, upserted: 0 }
      }

      try {
        let upserted = 0

        for (const doc of docs) {
          const docId = String(doc.id)

          const text = truncateText(String(doc.text ?? ''), config.maxDocChars)
          const chunks = chunkText(text, config.chunkSizeChars, config.overlapChars)

          db.deleteByDocId(docId)

          for (const chunk of chunks) {
            const vec = await embeddings.embedText(chunk.text, config.maxDocChars)
            const chunkId = `${docId}:${chunk.chunkIndex}`

            db.insertChunk({
              id: chunkId,
              docId,
              source: doc.source,
              sourceId: doc.sourceId,
              title: doc.title,
              mimeType: doc.mimeType,
              createdAt: doc.createdAt,
              chunkIndex: chunk.chunkIndex,
              text: chunk.text,
              metaJson: safeJsonStringify(doc.meta ?? {}),
              embeddingJson: JSON.stringify(vec),
            })

            upserted += 1
          }
        }

        return { ok: true, upserted }
      } catch (error: unknown) {
        return { ok: false, upserted: 0, error: toRagError(error) }
      }
    },

    async query(query: string, topK?: number, filters?: RagQueryFilters): Promise<RagQueryResult> {
      const q = truncateText(String(query ?? ''), config.maxQueryChars)
      const k = normalizeTopK(topK)

      if (!q.trim()) {
        return { ok: false, query: q, results: [], error: { kind: 'invalid_input', message: 'Query is empty' } }
      }

      try {
        const queryVec = await embeddings.embedText(q, config.maxQueryChars)

        const limit = filters ? Math.max(k * 50, k) : config.candidateLimit
        const candidates = db.selectCandidates({ filters, limit })

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
          let vec: unknown = null
          try {
            vec = JSON.parse(row.embeddingJson)
          } catch {
            vec = null
          }

          const vecArr = Array.isArray(vec) ? (vec as unknown[]) : []
          const numVec = vecArr.every((n) => typeof n === 'number' && Number.isFinite(n)) ? (vecArr as number[]) : []
          const score = cosineSimilarity(queryVec, numVec)

          scored.push({
            id: row.id,
            score,
            source: row.source,
            sourceId: row.sourceId,
            title: row.title,
            text: row.text,
            meta: safeJsonParseObject(row.metaJson),
          })
        }

        scored.sort((a, b) => b.score - a.score)
        const results = scored.slice(0, k).map((s) => ({
          id: s.id,
          score: s.score,
          source: s.source,
          sourceId: s.sourceId,
          ...(s.title ? { title: s.title } : {}),
          excerpt: s.text.slice(0, excerptChars),
          ...(s.meta ? { meta: s.meta } : {}),
        }))

        return { ok: true, query: q, results }
      } catch (error: unknown) {
        return { ok: false, query: q, results: [], error: toRagError(error) }
      }
    },

    async deleteDocuments(ids: string[]): Promise<RagDeleteResult> {
      if (!Array.isArray(ids) || ids.length === 0) {
        return { ok: true, deleted: 0 }
      }

      try {
        const deleted = db.deleteByDocIds(ids)
        return { ok: true, deleted }
      } catch (error: unknown) {
        return { ok: false, deleted: 0, error: toRagError(error) }
      }
    },
  }
}
