import { z } from 'zod'
import type { RagQueryResult, RagService } from '../../rag/types.ts'

export const ragSearchUploadsDef = {
  name: 'rag_search_uploads',
  description: 'Semantic search over uploaded documents (stub; not implemented).',
  inputSchema: z.object({ query: z.string().min(1), topK: z.number().int().positive().optional() }),
}

export type RagSearchUploadsTool = {
  name: string
  description: string
  inputSchema: typeof ragSearchUploadsDef.inputSchema
  execute: (input: unknown) => Promise<RagQueryResult>
}

export function createRagSearchUploadsTool({ rag }: { rag: RagService }): RagSearchUploadsTool {
  return {
    ...ragSearchUploadsDef,
    async execute(input: unknown): Promise<RagQueryResult> {
      const parsed = ragSearchUploadsDef.inputSchema.safeParse(input)
      if (!parsed.success) {
        return {
          ok: false,
          query: '',
          results: [],
          error: { kind: 'invalid_input', message: 'Invalid input' },
        }
      }

      const { query, topK } = parsed.data
      const out = await rag.query(query, topK)
      return out
    },
  }
}
