// @ts-check

import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'
import crypto from 'node:crypto'

import { getUploadsRootDir, safeJoin } from './paths.js'

async function ensureUploadsDir() {
  const dir = getUploadsRootDir()
  await fsp.mkdir(dir, { recursive: true })
  return dir
}

/** @param {Uint8Array | Buffer} buffer */
function computeSha256(buffer) {
  const hash = crypto.createHash('sha256')
  hash.update(buffer)
  return hash.digest('hex')
}

/**
 * @param {{ id: string, extension: string, buffer: Uint8Array | Buffer }} args
 */
export async function writeStoredFile({ id, extension, buffer }) {
  const dir = await ensureUploadsDir()
  const safeExt = String(extension || '').toLowerCase().replace(/[^a-z0-9]/g, '')
  const storedName = safeExt ? `${id}.${safeExt}` : id
  const targetPath = safeJoin(dir, storedName)
  const sha256 = computeSha256(buffer)

  await fsp.writeFile(targetPath, buffer)

  return { storedName, sha256, path: targetPath }
}

/** @param {{ storedName: string }} entry */
export async function createDownloadStream(entry) {
  const dir = await ensureUploadsDir()
  const filePath = safeJoin(dir, entry.storedName)
  return fs.createReadStream(filePath)
}

/** @param {{ storedName: string }} entry */
export async function deleteStoredFile(entry) {
  const dir = await ensureUploadsDir()
  const filePath = safeJoin(dir, entry.storedName)
  try {
    await fsp.unlink(filePath)
  } catch {
    // ignore missing
  }
}
