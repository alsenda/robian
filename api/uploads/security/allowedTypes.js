// @ts-check

/**
 * Default allowed extensions. Override via UPLOAD_ALLOWED_EXTS="pdf,txt,..."
 */
export const DEFAULT_ALLOWED_EXTS = [
  'pdf',
  'txt',
  'md',
  'csv',
  'json',
  'xls',
  'xlsx',
  'doc',
  'docx',
]

export function getAllowedExtensions() {
  const raw = process.env.UPLOAD_ALLOWED_EXTS
  if (!raw) return DEFAULT_ALLOWED_EXTS
  const exts = raw
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean)
  return exts.length ? exts : DEFAULT_ALLOWED_EXTS
}

/** @param {string} ext */
export function isTextLikeExtension(ext) {
  return ['txt', 'md', 'csv', 'json'].includes(String(ext || '').toLowerCase())
}
