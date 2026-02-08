import type {
  RagDeleteResult,
  RagDocId,
  RagDocumentInput,
  RagQueryFilters,
  RagQueryResult,
  RagService,
  RagUpsertResult,
} from './types.js'

const UPSERT_NOT_IMPLEMENTED: RagUpsertResult = {
  ok: false,
  upserted: 0,
  error: {
    kind: 'not_implemented',
    message: 'RAG is not implemented yet. Developers must wire embeddings/vector index.',
  },
}

const DELETE_NOT_IMPLEMENTED: RagDeleteResult = {
  ok: false,
  deleted: 0,
  error: {
    kind: 'not_implemented',
    message: 'RAG is not implemented yet. Developers must wire embeddings/vector index.',
  },
}

export function createStubRagService(): RagService {
  return {
    async upsertDocuments(_docs: RagDocumentInput[]): Promise<RagUpsertResult> {
      return UPSERT_NOT_IMPLEMENTED
    },

    async deleteDocuments(_ids: RagDocId[]): Promise<RagDeleteResult> {
      return DELETE_NOT_IMPLEMENTED
    },

    async query(query: string, _topK?: number, _filters?: RagQueryFilters): Promise<RagQueryResult> {
      return {
        ok: false,
        query: String(query ?? ''),
        results: [],
        error: {
          kind: 'not_implemented',
          message:
            'RAG search is not implemented yet. Developers must wire embeddings/vector index.',
        },
      }
    },
  }
}
