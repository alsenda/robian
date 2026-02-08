import { randomUUID, createHash } from 'node:crypto'

import { getDb } from '../../db/index.ts'
import type { Database } from '../../db/types.ts'

import { extractTextFromUpload } from '../extract/index.ts'
import { normalizeText } from '../text/normalize.ts'
import { chunkText } from '../text/chunk.ts'
import { chunkPdfPages } from '../text/chunkPdf.ts'

import { insertChunks, upsertChunkVectors } from '../vectorStore.ts'
import { embedTexts } from '../embeddings/ollama.ts'

export type IngestInput = {
  userId: string
  documentId: string
  filename: string
  mimeType?: string
  buffer: Buffer
}

function parseIntEnv(name: string, fallback: number): number {
  const raw = process.env[name]
  const n = raw ? Number(raw) : NaN
  return Number.isFinite(n) ? Math.floor(n) : fallback
}

function sha256Hex(buffer: Buffer): string {
  const h = createHash('sha256')
  h.update(buffer)
  return h.digest('hex')
}

function oneLine(input: string): string {
  return String(input || '')
    .replace(/[\r\n\t]+/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim()
}

function ensureDocumentRow({
  db,
  userId,
  documentId,
  filename,
  mimeType,
  byteSize,
  sha256,
  status,
}: {
  db: Database
  userId: string
  documentId: string
  filename: string
  mimeType?: string
  byteSize: number
  sha256: string
  status: 'uploaded' | 'indexed' | 'failed'
}): void {
  const now = Date.now()

  db.prepare(
    `INSERT INTO documents (id, userId, filename, mimeType, byteSize, sha256, createdAt, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       userId = excluded.userId,
       filename = excluded.filename,
       mimeType = excluded.mimeType,
       byteSize = excluded.byteSize,
       sha256 = excluded.sha256,
       status = excluded.status`,
  ).run(
    documentId,
    userId,
    filename,
    mimeType ? String(mimeType) : null,
    Number.isFinite(byteSize) ? Math.floor(byteSize) : null,
    sha256,
    now,
    status,
  )
}

function setDocumentStatus(db: Database, documentId: string, status: 'uploaded' | 'indexed' | 'failed'): void {
  db.prepare('UPDATE documents SET status = ? WHERE id = ?').run(status, documentId)
}

function deleteExistingForDocument(db: Database, documentId: string): void {
  // chunk_vectors is a vec0 virtual table; it doesn't have FK constraints.
  db.prepare('DELETE FROM chunk_vectors WHERE chunkId IN (SELECT id FROM chunks WHERE documentId = ?)').run(documentId)
  db.prepare('DELETE FROM chunks WHERE documentId = ?').run(documentId)
}

export async function ingestDocument(input: IngestInput): Promise<{ chunksInserted: number }> {
  const userId = String(input.userId || '').trim()
  const documentId = String(input.documentId || '').trim()
  const filename = String(input.filename || '').trim() || 'upload'
  const mimeType = String(input.mimeType || 'application/octet-stream').trim()
  const buffer = input.buffer

  if (!userId) throw new Error('userId is required')
  if (!documentId) throw new Error('documentId is required')
  if (!Buffer.isBuffer(buffer) || buffer.length === 0) throw new Error('buffer is required')

  const db = getDb()

  const sha256 = sha256Hex(buffer)
  const byteSize = buffer.length

  // Record "uploaded" state before heavy work.
  ensureDocumentRow({ db, userId, documentId, filename, mimeType, byteSize, sha256, status: 'uploaded' })

  try {
    const extracted = await extractTextFromUpload(mimeType, buffer)

    const chunkSizeChars = parseIntEnv('RAG_CHUNK_SIZE_CHARS', 2000)
    const overlapChars = parseIntEnv('RAG_CHUNK_OVERLAP_CHARS', 200)
    const minChunkChars = parseIntEnv('RAG_CHUNK_MIN_CHARS', 300)

    const { chunks } = extracted.pages && extracted.pages.length
      ? chunkPdfPages(extracted.pages, {
          maxChars: chunkSizeChars,
          overlapChars,
          minChunkChars,
        })
      : (() => {
          const normalized = normalizeText(extracted.text || '')
          const chunks = chunkText(normalized, {
            maxChars: chunkSizeChars,
            overlapChars,
            minChunkChars,
          })
          return { chunks }
        })()

    const preparedChunks = chunks
      .map((c) => ({
        id: randomUUID(),
        documentId,
        chunkIndex: c.chunkIndex,
        content: String(c.content || '').trim(),
        pageStart: (c as any).pageStart,
        pageEnd: (c as any).pageEnd,
        charStart: c.charStart,
        charEnd: c.charEnd,
        createdAt: Date.now(),
      }))
      .filter((c) => c.content.length > 0)

    if (preparedChunks.length === 0) {
      // Still mark indexed: nothing to insert, but pipeline completed.
      deleteExistingForDocument(db, documentId)
      setDocumentStatus(db, documentId, 'indexed')
      return { chunksInserted: 0 }
    }

    // Remove any previous index for this documentId.
    deleteExistingForDocument(db, documentId)

    const inserted = insertChunks(preparedChunks, db)

    const batchSize = Math.max(1, parseIntEnv('RAG_EMBED_BATCH_SIZE', 32))

    const vectors: Array<{ chunkId: string; embedding: number[] }> = []
    for (let i = 0; i < inserted.length; i += batchSize) {
      const batch = inserted.slice(i, i + batchSize)
      const texts = batch.map((c) => c.content)
      const embeddings = await embedTexts(texts)

      for (let j = 0; j < batch.length; j++) {
        const row = batch[j]!
        vectors.push({ chunkId: row.id, embedding: embeddings[j]! })
      }
    }

    // upsertChunkVectors normalizes via vec_normalize(vec_f32(...))
    upsertChunkVectors(vectors, db)

    setDocumentStatus(db, documentId, 'indexed')

    return { chunksInserted: inserted.length }
  } catch (error: unknown) {
    try {
      setDocumentStatus(db, documentId, 'failed')
    } catch {
      // ignore
    }

    const message = error instanceof Error ? error.message : String(error ?? 'unknown error')
    if (process.env.NODE_ENV !== 'test') {
      console.error(`[ingest] failed for documentId=${documentId}: ${oneLine(message)}`)
    }

    throw error
  }
}
