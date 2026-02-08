import { z } from 'zod'
import type { RagQueryResult, RagService } from '../../rag/types.ts'

export const ragSearchUploadsDef = {
  name: 'rag_search_uploads',
  description:
    'Semantic search over local uploaded documents (RAG). Prefer searching over guessing when answers should be grounded in user files. Returns citation-ready metadata per result (filename, pageStart/pageEnd, chunkId, score). Use sourceId to scope to a specific upload when known (e.g., after list_uploads).',
  inputSchema: z.object({
    query: z.string().min(1),
    topK: z.number().int().positive().optional(),
    sourceId: z.string().min(1).optional(),
  }),
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

      const { query, topK, sourceId } = parsed.data
      try {
        return await rag.query(query, topK, {
          source: 'upload',
          ...(sourceId ? { sourceId } : {}),
        })
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : 'RAG unavailable'
        return {
          ok: false,
          query,
          results: [],
          error: { kind: 'rag_unavailable', message },
        }
      }
    },
  }
}
