import { z } from 'zod'
import { listManifestEntries } from '../db/manifest.js'

export const listUploadsDef = {
  name: 'list_uploads',
  description: 'List uploaded files (most recent first).',
  inputSchema: z.object({ limit: z.number().int().positive().optional() }),
}

export const listUploadsTool = {
  ...listUploadsDef,
  async execute(input) {
    const limit = input?.limit ? Math.min(200, input.limit) : 50
    const entries = await listManifestEntries()
    return {
      uploads: entries.slice(0, limit).map((u) => ({
        id: u.id,
        originalName: u.originalName,
        mimeType: u.mimeType,
        sizeBytes: u.sizeBytes,
        createdAt: u.createdAt,
      })),
    }
  },
}
