import path from 'node:path'

/**
 * Minimal detection helper.
 * We rely primarily on extension because browser-provided mimetypes are not reliable.
 */
export function detectType({
  originalName,
  mimeType,
}: {
  originalName: string
  mimeType?: string
}): { extension: string; mimeType: string } {
  const safeName = path.basename(String(originalName || 'upload'))
  const ext = path.extname(safeName).replace('.', '').toLowerCase() || 'bin'

  // Normalize common mimetypes for known extensions
  const normalizedMime = String(mimeType || '').toLowerCase()

  const mimeByExt: Record<string, string> = {
    pdf: 'application/pdf',
    txt: 'text/plain',
    md: 'text/markdown',
    csv: 'text/csv',
    json: 'application/json',
    xls: 'application/vnd.ms-excel',
    xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    doc: 'application/msword',
    docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  }

  const fallback = mimeByExt[ext] || normalizedMime || 'application/octet-stream'

  return {
    extension: ext,
    mimeType: fallback,
  }
}
