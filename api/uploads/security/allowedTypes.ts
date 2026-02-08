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
] as const

export function getAllowedExtensions(): string[] {
  const raw = process.env.UPLOAD_ALLOWED_EXTS
  if (!raw) return [...DEFAULT_ALLOWED_EXTS]

  const exts = raw
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean)

  return exts.length ? exts : [...DEFAULT_ALLOWED_EXTS]
}

export function isTextLikeExtension(ext: string): boolean {
  return ['txt', 'md', 'csv', 'json'].includes(String(ext || '').toLowerCase())
}
