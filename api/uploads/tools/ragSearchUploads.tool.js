import { z } from 'zod'

async function ragSearchUploadsStub({ query }) {
  return {
    ok: false,
    query: String(query || ''),
    results: [],
    error: {
      kind: 'not_implemented',
      message:
        'RAG search is not implemented yet. Developers must wire embeddings/vector index.',
    },
  }
}

export const ragSearchUploadsDef = {
  name: 'rag_search_uploads',
  description: 'Semantic search over uploaded documents (stub; not implemented).',
  inputSchema: z.object({ query: z.string().min(1), topK: z.number().int().positive().optional() }),
}

export const ragSearchUploadsTool = {
  ...ragSearchUploadsDef,
  async execute(input) {
    return ragSearchUploadsStub({ query: input?.query, topK: input?.topK })
  },
}
