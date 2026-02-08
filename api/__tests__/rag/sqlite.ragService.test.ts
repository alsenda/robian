import { afterEach, describe, expect, it } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { openRagSqliteDb } from '../../rag/sqlite/db.ts'
import { createSqliteRagService } from '../../rag/sqlite/ragService.sqlite.ts'
import type { EmbeddingsService } from '../../embeddings/types.ts'

function makeTempDbPath(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rag-sqlite-test-'))
  return path.join(dir, 'rag.sqlite')
}

describe('sqlite rag provider', () => {
  let dbPath: string | null = null
  let cleanupDir: string | null = null

  afterEach(() => {
    if (dbPath) {
      try {
        const dir = path.dirname(dbPath)
        cleanupDir = dir
      } catch {
        // ignore
      }
    }

    if (cleanupDir) {
      try {
        fs.rmSync(cleanupDir, { recursive: true, force: true })
      } catch {
        // ignore
      }
    }

    dbPath = null
    cleanupDir = null
  })

  it('upsertDocuments inserts chunks', async () => {
    dbPath = makeTempDbPath()

    const embeddings: EmbeddingsService = {
      async embedText(input: string, _maxChars?: number): Promise<number[]> {
        const t = String(input)
        if (t.startsWith('A')) return [1, 0]
        if (t.startsWith('B')) return [0, 1]
        return [0, 0]
      },
    }

    const db = openRagSqliteDb(dbPath)
    try {
      const rag = createSqliteRagService({
        db,
        embeddings,
        config: {
          chunkSizeChars: 5,
          overlapChars: 0,
          maxDocChars: 200_000,
          maxQueryChars: 4000,
          candidateLimit: 5000,
          excerptChars: 240,
        },
      })

      const out = await rag.upsertDocuments([
        {
          id: 'doc1',
          source: 'upload',
          sourceId: 'u1',
          title: 't',
          text: 'AaaaaBbbbb',
          mimeType: 'text/plain',
          createdAt: '2020-01-01T00:00:00.000Z',
          meta: { x: 1 },
        },
      ])

      expect(out.ok).toBe(true)
      expect(out.upserted).toBe(2)

      const rows = db.selectCandidates({ limit: 10_000 })
      expect(rows.length).toBe(2)
    } finally {
      try {
        db.close()
      } catch {
        // ignore
      }
    }
  })

  it('query returns expected ordering by similarity', async () => {
    dbPath = makeTempDbPath()

    const embeddings: EmbeddingsService = {
      async embedText(input: string, _maxChars?: number): Promise<number[]> {
        const t = String(input)
        if (t.startsWith('A')) return [1, 0]
        if (t.startsWith('B')) return [0, 1]
        return [1, 0]
      },
    }

    const db = openRagSqliteDb(dbPath)
    try {
      const rag = createSqliteRagService({
        db,
        embeddings,
        config: {
          chunkSizeChars: 5,
          overlapChars: 0,
          maxDocChars: 200_000,
          maxQueryChars: 4000,
          candidateLimit: 5000,
          excerptChars: 240,
        },
      })

      await rag.upsertDocuments([
        {
          id: 'doc1',
          source: 'upload',
          sourceId: 'u1',
          title: 't',
          text: 'AaaaaBbbbb',
          createdAt: '2020-01-01T00:00:00.000Z',
        },
      ])

      const out = await rag.query('A', 2)
      expect(out.ok).toBe(true)
      expect(out.results.length).toBe(2)
      expect(out.results[0]?.id).toBe('doc1:0')
      expect(String(out.results[0]?.excerpt || '')).toContain('Aaaaa')
      expect((out.results[0]?.score ?? -1)).toBeGreaterThan(out.results[1]?.score ?? -2)
    } finally {
      try {
        db.close()
      } catch {
        // ignore
      }
    }
  })
})
