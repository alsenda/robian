import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import os from 'node:os'
import path from 'node:path'
import fsp from 'node:fs/promises'

async function makeTempDir(): Promise<string> {
  const base = await fsp.mkdtemp(path.join(os.tmpdir(), 'theapp-uploads-tools-'))
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

describe('uploads tools (TS)', () => {
  const originalEnv = process.env
  let uploadsDir: string | undefined

  beforeEach(async () => {
    vi.resetModules()
    process.env = { ...originalEnv }
    uploadsDir = await makeTempDir()
    process.env.UPLOADS_DIR = uploadsDir
  })

  afterEach(async () => {
    process.env = originalEnv
    await rmDirSafe(uploadsDir)
  })

  it('list_uploads returns entries', async () => {
    const { addManifestEntry } = await import('../../uploads/db/manifest.js')
    const { listUploadsTool } = await import('../../chat/tools/index.ts')

    await addManifestEntry({
      id: 'u1',
      originalName: 'a.txt',
      storedName: 'u1.txt',
      mimeType: 'text/plain',
      sizeBytes: 1,
      createdAt: new Date().toISOString(),
      sha256: '0'.repeat(64),
      extension: 'txt',
      extractable: true,
      previewText: 'x',
    })

    const out = (await listUploadsTool.execute({ limit: 10 })) as any
    expect(out.uploads.length).toBe(1)
    expect(out.uploads[0].id).toBe('u1')
  })

  it('get_upload returns previewText for txt', async () => {
    const { addManifestEntry } = await import('../../uploads/db/manifest.js')
    const { getUploadTool } = await import('../../chat/tools/index.ts')

    await addManifestEntry({
      id: 'u2',
      originalName: 'note.txt',
      storedName: 'u2.txt',
      mimeType: 'text/plain',
      sizeBytes: 5,
      createdAt: new Date().toISOString(),
      sha256: '1'.repeat(64),
      extension: 'txt',
      extractable: true,
      previewText: 'hello world',
    })

    const out = (await getUploadTool.execute({ id: 'u2', maxChars: 5 })) as any
    expect(out.ok).toBe(true)
    expect(out.previewText).toBe('hello')
  })

  it('rag_search_uploads returns not_implemented error with empty results', async () => {
    const { ragSearchUploadsTool } = await import('../../chat/tools/index.ts')
    const out = (await ragSearchUploadsTool.execute({ query: 'anything', topK: 3 })) as any
    expect(out.ok).toBe(false)
    expect(out.results).toEqual([])
    expect(out.error?.kind).toBe('not_implemented')
    expect(String(out.error?.message || '')).toMatch(/not implemented/i)
  })
})
