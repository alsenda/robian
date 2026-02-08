import type { RagService } from './types.ts'
import { createStubRagService } from './ragService.stub.ts'

import { createOllamaEmbeddingsService, checkEmbeddingsHealth } from '../embeddings/ollamaEmbeddings.ts'
import type { EmbeddingsError, EmbeddingsService } from '../embeddings/types.ts'
import type { EmbeddingsHealth } from '../embeddings/ollamaEmbeddings.ts'
import { openSqliteDb } from './sqlite/db.ts'
import { createSqliteRagService } from './sqlite/ragService.sqlite.ts'

export interface RagServiceConfig {
  provider?: 'stub' | 'sqlite'
}

export function createRagService(config?: RagServiceConfig): RagService {
  const provider = process.env.RAG_PROVIDER ?? config?.provider ?? 'sqlite'

  function createUnavailableRagService(error: EmbeddingsError): RagService {
    return {
      async upsertDocuments(_docs) {
        return { ok: false, upserted: 0, error }
      },
      async deleteDocuments(_ids) {
        return { ok: false, deleted: 0, error }
      },
      async query(query, _topK, _filters) {
        return { ok: false, query, results: [], error }
      },
    }
  }

  function parseIntEnv(name: string, fallback: number): number {
    const raw = process.env[name]
    const n = raw ? Number(raw) : NaN
    return Number.isFinite(n) ? Math.floor(n) : fallback
  }

  function getOllamaUrl(): string {
    return String(process.env.OLLAMA_URL || 'http://localhost:11434').trim().replace(/\/+$/, '')
  }

  function getEmbedModel(): string {
    return String(
      process.env.OLLAMA_EMBED_MODEL ||
        process.env.OLLAMA_CHAT_MODEL ||
        process.env.OLLAMA_MODEL ||
        'robian:latest',
    ).trim()
  }

  function getDbPath(): string {
    return String(process.env.RAG_DB_PATH || 'data/rag.sqlite').trim()
  }

  const ragConfig = {
    chunkSizeChars: parseIntEnv('RAG_CHUNK_SIZE_CHARS', 1200),
    chunkOverlapChars: parseIntEnv('RAG_CHUNK_OVERLAP_CHARS', 200),
    maxTextCharsPerDoc: parseIntEnv('RAG_MAX_TEXT_CHARS_PER_DOC', 200_000),
    maxQueryChars: parseIntEnv('RAG_MAX_QUERY_CHARS', 4000),
    candidateLimit: parseIntEnv('RAG_CANDIDATE_LIMIT', 5000),
  }

  switch (provider) {
    case 'stub':
      return createStubRagService()

    case 'sqlite': {
      const db = openSqliteDb(getDbPath())
      const embeddings: EmbeddingsService = createOllamaEmbeddingsService({
        ollamaUrl: getOllamaUrl(),
        model: getEmbedModel(),
      })

      let initPromise: Promise<void> | null = null
      let delegate: RagService | null = null

      const init = async (): Promise<void> => {
        if (delegate) return
        if (!initPromise) {
          initPromise = (async () => {
            const health: EmbeddingsHealth = await checkEmbeddingsHealth(embeddings)
            if (!health.ok) {
              delegate = createUnavailableRagService(health.error)
              return
            }
            delegate = createSqliteRagService({
              db,
              embeddings,
              config: ragConfig,
              embeddingsHealth: health,
            })
          })()
        }
        await initPromise
      }

      return {
        async upsertDocuments(docs) {
          await init()
          return (delegate as RagService).upsertDocuments(docs)
        },
        async deleteDocuments(ids) {
          await init()
          return (delegate as RagService).deleteDocuments(ids)
        },
        async query(query, topK, filters) {
          await init()
          return (delegate as RagService).query(query, topK, filters)
        },
      }
    }

    default:
      return createStubRagService()
  }
}
