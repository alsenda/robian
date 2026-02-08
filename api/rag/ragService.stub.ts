import type {
  RagDeleteResult,
  RagDocId,
  RagDocumentInput,
  RagQueryFilters,
  RagQueryResult,
  RagService,
  RagUpsertResult,
} from './types.ts'


export function createStubRagService(): RagService {
  return {
    async upsertDocuments(_docs: RagDocumentInput[]): Promise<RagUpsertResult> {
      return {
        ok: false,
        upserted: 0,
        error: {
          kind: 'not_implemented',
          message:
            'RAG is not implemented yet. Developers must wire embeddings/vector index.',
        },
      }
    },

    async deleteDocuments(_ids: RagDocId[]): Promise<RagDeleteResult> {
      return {
        ok: false,
        deleted: 0,
        error: {
          kind: 'not_implemented',
          message:
            'RAG is not implemented yet. Developers must wire embeddings/vector index.',
        },
      }
    },

    async query(query: string, _topK?: number, _filters?: RagQueryFilters): Promise<RagQueryResult> {
      return {
        ok: false,
        query,
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
