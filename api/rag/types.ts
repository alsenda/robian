export type RagDocId = string;

export type RagSource = "upload";

export interface RagDocumentInput {
  id: RagDocId;
  source: RagSource;
  sourceId: string;
  title?: string;
  text: string;
  mimeType?: string;
  createdAt: string;
  meta?: Record<string, unknown>;
}

export interface RagError {
  kind: string;
  message: string;
  details?: Array<{ field: string; message: string }>;
}

export interface RagUpsertResult {
  ok: boolean;
  upserted: number;
  error?: RagError;
}

export interface RagDeleteResult {
  ok: boolean;
  deleted: number;
  error?: RagError;
}

export interface RagQueryFilters {
  source?: RagSource;
  sourceId?: string;
  mimeType?: string;
}

export interface RagQueryResultItem {
  id: RagDocId;
  /** Stable identifier for the retrieved chunk (alias of id). */
  chunkId?: string;
  /** Original document id (before chunking). */
  documentId?: string;
  /** Human-friendly source name (usually original filename). */
  filename?: string;
  /** Best-effort page range. For non-paginated text, may default to 1-1. */
  pageStart?: number;
  /** Best-effort page range. For non-paginated text, may default to 1-1. */
  pageEnd?: number;
  score: number;
  source: RagSource;
  sourceId: string;
  title?: string;
  excerpt?: string;
  meta?: Record<string, unknown>;

  /** Optional lexical debug signal for hybrid search. */
  matchCount?: number;
  /** Subset of query terms found in the chunk (lowercased tokens). */
  matchedTerms?: string[];
  /** True if all query terms were found in the chunk. */
  hasAllTerms?: boolean;
  /** 1 when the full query phrase appears in the chunk (case-insensitive). */
  phraseBoost?: number;
}

export interface RagQueryResult {
  ok: boolean;
  query: string;
  results: RagQueryResultItem[];
  /** True when the best result has no lexical matches (used for retry heuristics). */
  weak?: boolean;
  error?: RagError;
}

export interface RagService {
  upsertDocuments(docs: RagDocumentInput[]): Promise<RagUpsertResult>;
  deleteDocuments(ids: RagDocId[]): Promise<RagDeleteResult>;
  query(query: string, topK?: number, filters?: RagQueryFilters): Promise<RagQueryResult>;
}
