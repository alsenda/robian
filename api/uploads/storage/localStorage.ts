import fs from 'node:fs'
import fsp from 'node:fs/promises'
import crypto from 'node:crypto'

import { getUploadsRootDir, safeJoin } from './paths.ts'

async function ensureUploadsDir(): Promise<string> {
  const dir = getUploadsRootDir()
  await fsp.mkdir(dir, { recursive: true })
  return dir
}

function computeSha256(buffer: Uint8Array | Buffer): string {
  const hash = crypto.createHash('sha256')
  hash.update(buffer)
  return hash.digest('hex')
}

export async function writeStoredFile({
  id,
  extension,
  buffer,
}: {
  id: string
  extension: string
  buffer: Uint8Array | Buffer
}): Promise<{ storedName: string; sha256: string; path: string }> {
  const dir = await ensureUploadsDir()
  const safeExt = String(extension || '').toLowerCase().replace(/[^a-z0-9]/g, '')
  const storedName = safeExt ? `${id}.${safeExt}` : id
  const targetPath = safeJoin(dir, storedName)
  const sha256 = computeSha256(buffer)

  await fsp.writeFile(targetPath, buffer)

  return { storedName, sha256, path: targetPath }
}

export async function createDownloadStream(entry: { storedName: string }): Promise<fs.ReadStream> {
  const dir = await ensureUploadsDir()
  const filePath = safeJoin(dir, entry.storedName)
  return fs.createReadStream(filePath)
}

export async function deleteStoredFile(entry: { storedName: string }): Promise<void> {
  const dir = await ensureUploadsDir()
  const filePath = safeJoin(dir, entry.storedName)
  try {
    await fsp.unlink(filePath)
  } catch {
    // ignore missing
  }
}
