import express from 'express'
import multer from 'multer'
import { randomUUID } from 'node:crypto'

import { validateUploadOrThrow } from './security/validateUpload.js'
import { detectType } from './parsing/detectType.js'
import { extractPreviewText } from './parsing/textExtract.stub.js'
import { writeStoredFile, deleteStoredFile, createDownloadStream } from './storage/localStorage.js'
import {
  addManifestEntry,
  deleteManifestEntry,
  getManifestEntry,
  listManifestEntries,
} from './db/manifest.js'

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: validateUploadOrThrow.getMaxBytes(),
  },
})

export const uploadsRouter = express.Router()

uploadsRouter.post('/', upload.single('file'), async (req, res) => {
  try {
    const file = req.file
    if (!file) {
      return res.status(400).json({ ok: false, error: { message: 'Missing multipart file field "file"' } })
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
      originalName: validateUploadOrThrow.sanitizeFilename(file.originalname),
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

    return res.status(200).json({ ok: true, upload: entry })
  } catch (error) {
    // Multer file size errors
    if (error && typeof error === 'object' && error.code === 'LIMIT_FILE_SIZE') {
      return res.status(413).json({ ok: false, error: { message: 'File too large' } })
    }
    const message = error?.message || 'Upload failed'
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
  return res.status(200).json({ ok: true })
})

// Multer (and other) middleware errors
uploadsRouter.use((err, _req, res, _next) => {
  if (err && typeof err === 'object' && err.code === 'LIMIT_FILE_SIZE') {
    return res.status(413).json({ ok: false, error: { message: 'File too large' } })
  }
  const message = err?.message || 'Upload failed'
  return res.status(400).json({ ok: false, error: { message } })
})
