import express from 'express'
import multer from 'multer'
import { randomUUID } from 'node:crypto'

import { validateUploadOrThrow, sanitizeFilename, getMaxBytes } from './security/validateUpload.ts'
import { detectType } from './parsing/detectType.ts'
import { extractPreviewText } from './parsing/textExtract.stub.ts'
import { writeStoredFile, deleteStoredFile, createDownloadStream } from './storage/localStorage.ts'
import {
  addManifestEntry,
  deleteManifestEntry,
  getManifestEntry,
  listManifestEntries,
} from './db/manifest.ts'

import type { RagService, RagDocumentInput } from '../rag/types.ts'

export interface CreateUploadsRouterDeps {
  rag: RagService
}

const RAG_TEXT_MIME_TYPES = new Set(['text/plain', 'text/markdown', 'application/json', 'text/csv'])

function parseIntEnv(name: string, fallback: number): number {
  const raw = process.env[name]
  const n = raw ? Number(raw) : NaN
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback
}

function isNotImplementedError(result: { error?: { kind?: string } } | null | undefined): boolean {
  return Boolean(result?.error?.kind === 'not_implemented')
}

async function bestEffortUpsertToRag({
  rag,
  doc,
}: {
  rag: RagService
  doc: RagDocumentInput
}): Promise<void> {
  try {
    const out = await rag.upsertDocuments([doc])
    if (isNotImplementedError(out)) {
      if (process.env.NODE_ENV !== 'production' && process.env.NODE_ENV !== 'test') {
        console.log('[uploads] RAG upsert skipped (not implemented)')
      }
      return
    }

    if (!out.ok && process.env.NODE_ENV !== 'production' && process.env.NODE_ENV !== 'test') {
      console.log('[uploads] RAG upsert failed')
    }
  } catch (error: unknown) {
    if (process.env.NODE_ENV !== 'production' && process.env.NODE_ENV !== 'test') {
      const message = error instanceof Error ? error.message : 'unknown error'
      console.log(`[uploads] RAG upsert threw: ${message}`)
    }
  }
}

async function bestEffortDeleteFromRag({ rag, id }: { rag: RagService; id: string }): Promise<void> {
  try {
    const out = await rag.deleteDocuments([id])
    if (isNotImplementedError(out)) {
      if (process.env.NODE_ENV !== 'production' && process.env.NODE_ENV !== 'test') {
        console.log('[uploads] RAG delete skipped (not implemented)')
      }
      return
    }
    if (!out.ok && process.env.NODE_ENV !== 'production' && process.env.NODE_ENV !== 'test') {
      console.log('[uploads] RAG delete failed')
    }
  } catch (error: unknown) {
    if (process.env.NODE_ENV !== 'production' && process.env.NODE_ENV !== 'test') {
      const message = error instanceof Error ? error.message : 'unknown error'
      console.log(`[uploads] RAG delete threw: ${message}`)
    }
  }
}

export function createUploadsRouter(deps: CreateUploadsRouterDeps): express.Router {
  const rag = deps.rag

  const upload = multer({
    storage: multer.memoryStorage(),
    limits: {
      fileSize: getMaxBytes(),
    },
  })

  const uploadsRouter = express.Router()

  uploadsRouter.post('/', upload.single('file'), async (req, res) => {
    try {
      const file = req.file
      if (!file) {
        return res
          .status(400)
          .json({ ok: false, error: { message: 'Missing multipart file field "file"' } })
      }

      validateUploadOrThrow({
        originalName: file.originalname,
        mimeType: file.mimetype,
        sizeBytes: file.size,
      })

      const id = randomUUID()
      const typeInfo = detectType({ originalName: file.originalname, mimeType: file.mimetype })

      const preview = extractPreviewText({
        buffer: file.buffer,
        extension: typeInfo.extension,
        maxChars: 20_000,
      })

      const stored = await writeStoredFile({
        id,
        extension: typeInfo.extension,
        buffer: file.buffer,
      })

      const createdAt = new Date().toISOString()

      const entry = {
        id,
        originalName: sanitizeFilename(file.originalname),
        storedName: stored.storedName,
        mimeType: typeInfo.mimeType,
        sizeBytes: file.size,
        createdAt,
        sha256: stored.sha256,
        extension: typeInfo.extension,
        extractable: preview.extractable,
        previewText: preview.previewText,
      }

      await addManifestEntry(entry)

      // Best-effort RAG upsert for plain-text extractable mime types only.
      if (RAG_TEXT_MIME_TYPES.has(String(typeInfo.mimeType || '').toLowerCase())) {
        const maxChars = parseIntEnv('RAG_MAX_TEXT_CHARS_PER_DOC', 200_000)
        const text = Buffer.from(file.buffer).toString('utf8').slice(0, maxChars)
        const doc: RagDocumentInput = {
          id,
          source: 'upload',
          sourceId: id,
          title: entry.originalName,
          text,
          mimeType: entry.mimeType,
          createdAt,
          meta: {
            sha256: entry.sha256,
            storedName: entry.storedName,
            sizeBytes: entry.sizeBytes,
            extension: entry.extension,
          },
        }

        void bestEffortUpsertToRag({ rag, doc })
      }

      return res.status(200).json({ ok: true, upload: entry })
    } catch (error: unknown) {
      const err = error as { code?: string; message?: string } | null
      // Multer file size errors
      if (err && typeof err === 'object' && err.code === 'LIMIT_FILE_SIZE') {
        return res.status(413).json({ ok: false, error: { message: 'File too large' } })
      }
      const message = (err && typeof err === 'object' && err.message) || 'Upload failed'
      return res.status(400).json({ ok: false, error: { message } })
    }
  })

  uploadsRouter.get('/', async (_req, res) => {
    const entries = await listManifestEntries()
    res.status(200).json({ ok: true, uploads: entries })
  })

  uploadsRouter.get('/:id', async (req, res) => {
    const { id } = req.params
    const entry = await getManifestEntry(id)
    if (!entry) {
      return res.status(404).json({ ok: false, error: { message: 'Not found' } })
    }
    return res.status(200).json({
      ok: true,
      upload: entry,
      downloadUrl: `/api/uploads/${encodeURIComponent(id)}/download`,
    })
  })

  uploadsRouter.get('/:id/download', async (req, res) => {
    const { id } = req.params
    const entry = await getManifestEntry(id)
    if (!entry) {
      return res.status(404).json({ ok: false, error: { message: 'Not found' } })
    }

    const stream = await createDownloadStream(entry)
    res.status(200)
    res.setHeader('Content-Type', entry.mimeType || 'application/octet-stream')
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${encodeURIComponent(entry.originalName || entry.storedName)}"`,
    )

    stream.on('error', () => {
      try {
        res.status(500).end('Download failed')
      } catch {
        // ignore
      }
    })

    stream.pipe(res)
  })

  uploadsRouter.delete('/:id', async (req, res) => {
    const { id } = req.params
    const entry = await getManifestEntry(id)
    if (!entry) {
      return res.status(404).json({ ok: false, error: { message: 'Not found' } })
    }

    await deleteStoredFile(entry)
    await deleteManifestEntry(id)

    void bestEffortDeleteFromRag({ rag, id })

    return res.status(200).json({ ok: true })
  })

  // Multer (and other) middleware errors
  uploadsRouter.use((err: unknown, _req: unknown, res: express.Response, _next: unknown) => {
    const e = err as { code?: string; message?: string } | null
    if (e && typeof e === 'object' && e.code === 'LIMIT_FILE_SIZE') {
      return res.status(413).json({ ok: false, error: { message: 'File too large' } })
    }
    const message = (e && typeof e === 'object' && e.message) || 'Upload failed'
    return res.status(400).json({ ok: false, error: { message } })
  })

  return uploadsRouter
}
