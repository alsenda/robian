// @ts-check

import path from 'node:path'
import { getAllowedExtensions } from './allowedTypes.js'
import { detectType } from '../parsing/detectType.js'

const DEFAULT_MAX_BYTES = 10 * 1024 * 1024

/** @param {unknown} value */
function parseMaxBytes(value) {
  const n = Number(value)
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : DEFAULT_MAX_BYTES
}

/** @param {string} name */
export function sanitizeFilename(name) {
  const base = path.basename(String(name || 'upload'))
  // Remove control chars and path separators just in case
  return base
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .replace(/[\\/]/g, '_')
    .slice(0, 255) || 'upload'
}

export function getMaxBytes() {
  return parseMaxBytes(process.env.UPLOAD_MAX_BYTES)
}

/** @param {{ originalName: string, mimeType?: string, sizeBytes: number }} args */
export function validateUploadOrThrow({ originalName, mimeType, sizeBytes }) {
  const maxBytes = getMaxBytes()
  if (sizeBytes > maxBytes) {
    /** @type {Error & { code?: string }} */
    const error = new Error('File too large')
    error.code = 'UPLOAD_TOO_LARGE'
    throw error
  }

  const allowed = new Set(getAllowedExtensions())
  const { extension } = detectType(
    typeof mimeType === 'string' ? { originalName, mimeType } : { originalName },
  )
  if (!allowed.has(extension)) {
    throw new Error(`File type not allowed: .${extension}`)
  }
}

validateUploadOrThrow.sanitizeFilename = sanitizeFilename
validateUploadOrThrow.getMaxBytes = getMaxBytes
