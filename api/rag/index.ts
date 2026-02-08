import type { RagService } from './types.ts'
import { createStubRagService } from './ragService.stub.ts'

import { createOllamaEmbeddingsService } from '../embeddings/ollamaEmbeddings.ts'
import { openRagSqliteDb } from './sqlite/db.ts'
import { createSqliteRagService } from './sqlite/ragService.sqlite.ts'

export interface RagServiceConfig {
  provider?: 'stub' | 'sqlite'
}

export function createRagService(config?: RagServiceConfig): RagService {
  const provider = config?.provider ?? process.env.RAG_PROVIDER ?? 'sqlite'

  function parseIntEnv(name: string, fallback: number): number {
    const raw = process.env[name]
    const n = raw ? Number(raw) : NaN
    return Number.isFinite(n) ? Math.floor(n) : fallback
  }

  function getOllamaUrl(): string {
    return String(process.env.OLLAMA_URL || 'http://localhost:11434').trim().replace(/\/+$/, '')
  }

  function getEmbedModel(): string {
    return String(process.env.OLLAMA_EMBED_MODEL || 'robian:latest').trim()
  }

  function getDbPath(): string {
    return String(process.env.RAG_DB_PATH || 'data/rag.sqlite').trim()
  }

  const ragConfig = {
    chunkSizeChars: parseIntEnv('RAG_CHUNK_SIZE_CHARS', 1200),
    overlapChars: parseIntEnv('RAG_CHUNK_OVERLAP_CHARS', 200),
    maxDocChars: parseIntEnv('RAG_MAX_TEXT_CHARS_PER_DOC', 200_000),
    maxQueryChars: parseIntEnv('RAG_MAX_QUERY_CHARS', 4000),
    candidateLimit: parseIntEnv('RAG_CANDIDATE_LIMIT', 5000),
    excerptChars: parseIntEnv('RAG_EXCERPT_CHARS', 240),
  }

  switch (provider) {
    case 'stub':
      return createStubRagService()

    case 'sqlite': {
      const db = openRagSqliteDb(getDbPath())
      const embeddings = createOllamaEmbeddingsService({
        ollamaUrl: getOllamaUrl(),
        model: getEmbedModel(),
      })

      return createSqliteRagService({
        db,
        embeddings,
        config: ragConfig,
      })
    }

    default:
      return createStubRagService()
  }
}
