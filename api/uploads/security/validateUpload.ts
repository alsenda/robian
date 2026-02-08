import path from 'node:path'

import { getAllowedExtensions } from './allowedTypes.ts'
import { detectType } from '../parsing/detectType.ts'

const DEFAULT_MAX_BYTES = 10 * 1024 * 1024

function parseMaxBytes(value: unknown): number {
  const n = Number(value)
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : DEFAULT_MAX_BYTES
}

export function sanitizeFilename(name: string): string {
  const base = path.basename(String(name || 'upload'))
  // Remove control chars and path separators just in case
  return (
    base
      .replace(/[\u0000-\u001f\u007f]/g, '')
      .replace(/[\\/]/g, '_')
      .slice(0, 255) || 'upload'
  )
}

export function getMaxBytes(): number {
  return parseMaxBytes(process.env.UPLOAD_MAX_BYTES)
}

export function validateUploadOrThrow({
  originalName,
  mimeType,
  sizeBytes,
}: {
  originalName: string
  mimeType?: string
  sizeBytes: number
}): void {
  const maxBytes = getMaxBytes()
  if (sizeBytes > maxBytes) {
    const error = new Error('File too large') as Error & { code?: string }
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
