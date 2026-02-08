import { z } from 'zod'
import type { RagService } from '../../rag/types.js'

export const ragSearchUploadsDef = {
  name: 'rag_search_uploads',
  description: 'Semantic search over uploaded documents (stub; not implemented).',
  inputSchema: z.object({ query: z.string().min(1), topK: z.number().int().positive().optional() }),
}

export function createRagSearchUploadsTool(ragService: RagService) {
  return {
    ...ragSearchUploadsDef,
    async execute(input: unknown): Promise<unknown> {
      const parsed = ragSearchUploadsDef.inputSchema.safeParse(input)
      if (!parsed.success) {
        return { ok: false, query: '', results: [], error: { kind: 'invalid_input', message: 'Invalid input' } }
      }

      const { query, topK } = parsed.data
      return ragService.query(query, topK)
    },
  }
}
