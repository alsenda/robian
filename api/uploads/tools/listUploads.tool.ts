import { z } from 'zod'
import { listManifestEntries } from '../db/manifest.ts'

export const listUploadsDef = {
  name: 'list_uploads',
  description: 'List uploaded files (most recent first).',
  inputSchema: z.object({ limit: z.number().int().positive().optional() }),
}

export const listUploadsTool = {
  ...listUploadsDef,
  async execute(input: unknown): Promise<unknown> {
    const parsed = listUploadsDef.inputSchema.safeParse(input)
    if (!parsed.success) {
      return { uploads: [] }
    }

    const limit = parsed.data.limit ? Math.min(200, parsed.data.limit) : 50
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
