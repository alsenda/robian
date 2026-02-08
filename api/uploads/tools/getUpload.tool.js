import { z } from 'zod'
import { getManifestEntry } from '../db/manifest.js'

export const getUploadDef = {
  name: 'get_upload',
  description:
    'Get upload metadata and (if text-like) a previewText snippet. For PDFs/Office files, previewText is empty unless parsing is implemented.',
  inputSchema: z.object({ id: z.string().min(1), maxChars: z.number().int().positive().optional() }),
}

export const getUploadTool = {
  ...getUploadDef,
  async execute(input) {
    const id = String(input?.id || '')
    const entry = await getManifestEntry(id)
    if (!entry) {
      return { ok: false, error: { message: 'Upload not found' } }
    }
    const maxChars = input?.maxChars ? Math.min(20000, input.maxChars) : 20000
    const previewText = entry.previewText ? String(entry.previewText).slice(0, maxChars) : ''
    return { ok: true, upload: entry, previewText }
  },
}
