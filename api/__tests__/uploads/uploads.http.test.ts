import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import request from 'supertest'
import os from 'node:os'
import path from 'node:path'
import fsp from 'node:fs/promises'

async function makeTempDir(): Promise<string> {
  const base = await fsp.mkdtemp(path.join(os.tmpdir(), 'theapp-uploads-'))
  return base
}

async function rmDirSafe(dir: string | undefined): Promise<void> {
  if (!dir) return
  try {
    await fsp.rm(dir, { recursive: true, force: true })
  } catch {
    // ignore
  }
}

describe('uploads HTTP API (TS)', () => {
  const originalEnv = process.env
  let uploadsDir: string | undefined

  beforeEach(async () => {
    vi.resetModules()
    vi.clearAllMocks()
    process.env = { ...originalEnv }
    uploadsDir = await makeTempDir()
    process.env.UPLOADS_DIR = uploadsDir
    delete process.env.UPLOAD_ALLOWED_EXTS
    delete process.env.UPLOAD_MAX_BYTES
  })

  afterEach(async () => {
    process.env = originalEnv
    await rmDirSafe(uploadsDir)
    vi.unmock('../../rag/index.ts')
  })

  it('rejects disallowed types', async () => {
    const { createApp } = await import('../../app.ts')
    const app = createApp()

    const res = await request(app)
      .post('/api/uploads')
      .attach('file', Buffer.from('hello'), {
        filename: 'evil.exe',
        contentType: 'application/octet-stream',
      })

    expect(res.status).toBe(400)
    expect(res.body.ok).toBe(false)
    expect(String(res.body.error?.message || '')).toMatch(/not allowed/i)
  })

  it('rejects large files via UPLOAD_MAX_BYTES', async () => {
    process.env.UPLOAD_MAX_BYTES = '10'

    const { createApp } = await import('../../app.ts')
    const app = createApp()

    const res = await request(app)
      .post('/api/uploads')
      .attach('file', Buffer.alloc(50, 'a'), {
        filename: 'big.txt',
        contentType: 'text/plain',
      })

    // Multer limit triggers 413; our handler maps LIMIT_FILE_SIZE to 413.
    expect([400, 413]).toContain(res.status)
    expect(res.body.ok).toBe(false)
  })

  it('saves manifest + file and lists entries', async () => {
    const { createApp } = await import('../../app.ts')
    const app = createApp()

    const uploadRes = await request(app)
      .post('/api/uploads')
      .attach('file', Buffer.from('hello world'), {
        filename: 'note.txt',
        contentType: 'text/plain',
      })

    expect(uploadRes.status).toBe(200)
    expect(uploadRes.body.ok).toBe(true)
    expect(uploadRes.body.upload?.id).toBeTruthy()
    expect(uploadRes.body.upload?.sha256).toMatch(/^[a-f0-9]{64}$/)
    expect(String(uploadRes.body.upload?.previewText || '')).toContain('hello')

    const manifestPath = path.join(uploadsDir || '', 'manifest.json')
    const manifestRaw = await fsp.readFile(manifestPath, 'utf8')
    const manifest = JSON.parse(manifestRaw) as { uploads?: Array<{ id: string }> }
    expect(Array.isArray(manifest.uploads)).toBe(true)
    expect(manifest.uploads?.[0]?.id).toBe(uploadRes.body.upload.id)

    const storedName = uploadRes.body.upload.storedName
    await expect(fsp.stat(path.join(uploadsDir || '', storedName))).resolves.toBeTruthy()

    const listRes = await request(app).get('/api/uploads')
    expect(listRes.status).toBe(200)
    expect(listRes.body.ok).toBe(true)
    expect(listRes.body.uploads.length).toBeGreaterThan(0)
  })

  it('streams downloads', async () => {
    const { createApp } = await import('../../app.ts')
    const app = createApp()

    const uploadRes = await request(app)
      .post('/api/uploads')
      .attach('file', Buffer.from('download-me'), {
        filename: 'd.txt',
        contentType: 'text/plain',
      })

    const id = uploadRes.body.upload.id as string
    const dl = await request(app).get(`/api/uploads/${encodeURIComponent(id)}/download`)
    expect(dl.status).toBe(200)
    expect(String((dl as any).text || (dl as any).body || '')).toContain('download-me')
  })

  it('deletes entry + file', async () => {
    const { createApp } = await import('../../app.ts')
    const app = createApp()

    const uploadRes = await request(app)
      .post('/api/uploads')
      .attach('file', Buffer.from('bye'), {
        filename: 'bye.txt',
        contentType: 'text/plain',
      })
    const id = uploadRes.body.upload.id as string
    const storedName = uploadRes.body.upload.storedName as string

    const del = await request(app).delete(`/api/uploads/${encodeURIComponent(id)}`)
    expect(del.status).toBe(200)
    expect(del.body.ok).toBe(true)

    await expect(fsp.stat(path.join(uploadsDir || '', storedName))).rejects.toBeTruthy()

    const listRes = await request(app).get('/api/uploads')
    expect(listRes.body.uploads.find((u: any) => u.id === id)).toBeFalsy()
  })

  it('uploads succeed even when RAG is not implemented (best-effort), and upsert is invoked for small txt', async () => {
    const upsertDocuments = vi.fn(async () => ({
      ok: false,
      upserted: 0,
      error: {
        kind: 'not_implemented',
        message: 'RAG is not implemented yet. Developers must wire embeddings/vector index.',
      },
    }))

    const deleteDocuments = vi.fn(async () => ({
      ok: false,
      deleted: 0,
      error: {
        kind: 'not_implemented',
        message: 'RAG is not implemented yet. Developers must wire embeddings/vector index.',
      },
    }))

    const query = vi.fn(async (q: string) => ({
      ok: false,
      query: q,
      results: [],
      error: {
        kind: 'not_implemented',
        message: 'RAG search is not implemented yet. Developers must wire embeddings/vector index.',
      },
    }))

    vi.doMock('../../rag/index.ts', async () => {
      const actual = await vi.importActual<typeof import('../../rag/index.ts')>('../../rag/index.ts')
      return {
        ...actual,
        createRagService: vi.fn(() => ({ upsertDocuments, deleteDocuments, query })),
      }
    })

    vi.resetModules()
    const { createApp } = await import('../../app.ts')
    const app = createApp()

    const uploadRes = await request(app)
      .post('/api/uploads')
      .attach('file', Buffer.from('hello rag'), {
        filename: 'rag.txt',
        contentType: 'text/plain',
      })

    expect(uploadRes.status).toBe(200)
    expect(uploadRes.body.ok).toBe(true)
    const uploadId = String(uploadRes.body.upload?.id || '')
    expect(uploadId).toBeTruthy()
    const createdAt = String(uploadRes.body.upload?.createdAt || '')
    expect(createdAt).toMatch(/\d{4}-\d{2}-\d{2}T/)

    // best-effort work is async; allow it to run
    await new Promise((r) => setTimeout(r, 0))

    // best-effort: should have attempted upsert
    expect(upsertDocuments).toHaveBeenCalledTimes(1)
    const calls = upsertDocuments.mock.calls as unknown as unknown[][]
    const firstCall = calls[0]
    expect(firstCall).toBeTruthy()
    const docsArgUnknown = (firstCall as unknown[])[0]
    expect(Array.isArray(docsArgUnknown)).toBe(true)
    const docsArg = docsArgUnknown as Array<Record<string, unknown>>
    expect(docsArg[0]?.id).toBe(uploadId)
    expect(docsArg[0]?.source).toBe('upload')
    expect(docsArg[0]?.sourceId).toBe(uploadId)
    expect(docsArg[0]?.title).toBe('rag.txt')
    expect(docsArg[0]?.mimeType).toBe('text/plain')
    expect(String(docsArg[0]?.createdAt || '')).toBe(createdAt)
    expect(String(docsArg[0]?.text || '')).toContain('hello rag')
    expect(docsArg[0]?.meta && typeof docsArg[0]?.meta === 'object').toBe(true)

    const delRes = await request(app).delete(`/api/uploads/${encodeURIComponent(uploadId)}`)
    expect(delRes.status).toBe(200)
    expect(delRes.body.ok).toBe(true)

    await new Promise((r) => setTimeout(r, 0))
    expect(deleteDocuments).toHaveBeenCalledTimes(1)
    expect(deleteDocuments).toHaveBeenCalledWith([uploadId])
  })
})
