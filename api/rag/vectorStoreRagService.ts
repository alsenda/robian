import type {
  RagDeleteResult,
  RagDocId,
  RagDocumentInput,
  RagError,
  RagQueryFilters,
  RagQueryResult,
  RagQueryResultItem,
  RagService,
  RagUpsertResult,
} from "./types.ts";

import { embedQuery } from "../../src/server/rag/embeddings/ollama.ts";
import { vectorSearch } from "../../src/server/rag/vectorStore.ts";
import { ingestDocument } from "../../src/server/rag/ingest/ingestDocument.ts";
import { getDb, initDb } from "../../src/server/db/index.ts";
import { getRagDbPath } from "../../src/server/db/ragDbPath.ts";
import { debugRagDb } from "../../src/server/db/ragDbDiag.ts";

function toRagError(error: unknown): RagError {
  if (error && typeof error === "object") {
    const kind = (error as { kind?: unknown }).kind;
    const message = (error as { message?: unknown }).message;
    if (typeof kind === "string" && typeof message === "string") {
      return { kind, message };
    }
  }

  if (error instanceof Error) {
    return { kind: "unknown", message: error.message || "Unknown error" };
  }

  return { kind: "unknown", message: "Unknown error" };
}

function normalizeTopK(topK: unknown): number {
  const n = typeof topK === "number" ? topK : topK != null ? Number(topK) : NaN;
  if (!Number.isFinite(n) || n <= 0) { return 8; }
  return Math.max(1, Math.min(50, Math.floor(n)));
}

function excerpt(text: string, maxChars = 240): string {
  const s = String(text ?? "");
  const cap = Number.isFinite(maxChars) && maxChars > 0 ? Math.floor(maxChars) : 240;
  return s.length <= cap ? s : s.slice(0, cap);
}

function asDocIdsFilter(filters?: RagQueryFilters): string[] | undefined {
  const src = filters?.source ? String(filters.source) : "";
  if (src && src !== "upload") { return []; }

  const sourceId = filters?.sourceId ? String(filters.sourceId).trim() : "";
  if (!sourceId) { return undefined; }
  return [sourceId];
}

function tokenizeQuery(query: string): string[] {
  const q = String(query ?? "").toLowerCase();
  const normalized = q.replace(/[^\p{L}\p{N}]+/gu, " ").trim();
  if (!normalized) { return []; }

  const parts = normalized.split(/\s+/g);
  const out: string[] = [];
  const seen = new Set<string>();
  for (const p of parts) {
    const t = p.trim();
    if (t.length < 3) { continue; }
    if (seen.has(t)) { continue; }
    seen.add(t);
    out.push(t);
  }
  return out;
}

function tokenizeText(text: string): Set<string> {
  const s = String(text ?? "").toLowerCase();
  const normalized = s.replace(/[^\p{L}\p{N}]+/gu, " ").trim();
  const set = new Set<string>();
  if (!normalized) { return set; }
  for (const p of normalized.split(/\s+/g)) {
    const t = p.trim();
    if (t.length < 3) { continue; }
    set.add(t);
  }
  return set;
}

function lexSignals(query: string, queryTokens: string[], chunkText: string): {
  matchCount: number;
  matchedTerms: string[];
  hasAllTerms: boolean;
  phraseBoost: number;
} {
  const qLower = String(query ?? "").toLowerCase().trim();
  const textLower = String(chunkText ?? "").toLowerCase();
  const phraseBoost = qLower && textLower.includes(qLower) ? 1 : 0;

  if (!queryTokens.length) {
    return { matchCount: 0, matchedTerms: [], hasAllTerms: false, phraseBoost };
  }

  const tokenSet = tokenizeText(chunkText);
  const matchedTerms = queryTokens.filter((t) => tokenSet.has(t));
  const matchCount = matchedTerms.length;
  const hasAllTerms = matchCount === queryTokens.length;
  return { matchCount, matchedTerms, hasAllTerms, phraseBoost };
}

export function createVectorStoreRagService(): RagService {
  // Ensure DB is initialized early so DEBUG_RAG_DB can show counts.
  initDb();
  debugRagDb("rag_service", { provider: "sqlite-vec", dbPath: getRagDbPath() });

  return {
    async upsertDocuments(docs: RagDocumentInput[]): Promise<RagUpsertResult> {
      const list = Array.isArray(docs) ? docs : [];
      if (list.length === 0) {
        return { ok: true, upserted: 0 };
      }

      try {
        let upserted = 0;
        for (const doc of list) {
          const id = String(doc.id || "").trim();
          if (!id) { continue; }

          const mimeType = String(doc.mimeType || "text/plain").trim() || "text/plain";
          const filename = String(doc.title || doc.sourceId || "upload").trim() || "upload";
          const text = String(doc.text ?? "");
          const buffer = Buffer.from(text, "utf8");

          const out = await ingestDocument({
            userId: "local",
            documentId: id,
            filename,
            mimeType,
            buffer,
          });
          // ingestDocument returns inserted chunk count.
          upserted += out.chunksInserted;
        }

        return { ok: true, upserted };
      } catch (error: unknown) {
        return { ok: false, upserted: 0, error: toRagError(error) };
      }
    },

    async deleteDocuments(ids: RagDocId[]): Promise<RagDeleteResult> {
      const list = Array.isArray(ids) ? ids.map((i) => String(i || "").trim()).filter(Boolean) : [];
      if (list.length === 0) {
        return { ok: true, deleted: 0 };
      }

      try {
        const db = getDb();

        let deletedDocs = 0;

        const tx = db.transaction(() => {
          for (const documentId of list) {
            // vec0 virtual table has no FK constraints.
            db.prepare(
              "DELETE FROM chunk_vectors WHERE chunkId IN (SELECT id FROM chunks WHERE documentId = ?)",
            ).run(documentId);
            db.prepare("DELETE FROM chunks WHERE documentId = ?").run(documentId);
            const res = db.prepare("DELETE FROM documents WHERE id = ?").run(documentId) as any;
            deletedDocs += Number(res?.changes || 0);
          }
        });

        tx();

        return { ok: true, deleted: deletedDocs };
      } catch (error: unknown) {
        return { ok: false, deleted: 0, error: toRagError(error) };
      }
    },

    async query(query: string, topK?: number, filters?: RagQueryFilters): Promise<RagQueryResult> {
      const q = String(query ?? "").trim();
      if (!q) {
        return {
          ok: false,
          query: "",
          results: [],
          error: { kind: "invalid_input", message: "Query is empty" },
        };
      }

      const k = normalizeTopK(topK);

      try {
        debugRagDb("query", {
          dbPath: getRagDbPath(),
          topK: k,
          hasSourceId: Boolean(filters?.sourceId),
        });

        const queryVec = await embedQuery(q);
        const docIds = asDocIdsFilter(filters);

        const candidateK = Math.max(k, Math.min(200, k * 5));

        const chunks = vectorSearch(queryVec, {
          userId: "local",
          topK: candidateK,
          ...(docIds && docIds.length ? { docIds } : {}),
        });

        const queryTokens = tokenizeQuery(q);
        const enriched = chunks.map((c) => {
          const s = queryTokens.length ? lexSignals(q, queryTokens, c.content) : null;
          return {
            chunk: c,
            matchCount: s?.matchCount ?? 0,
            matchedTerms: s?.matchedTerms ?? [],
            hasAllTerms: s?.hasAllTerms ?? false,
            phraseBoost: s?.phraseBoost ?? 0,
          };
        });

        const anyLexMatch = queryTokens.length
          ? enriched.some((e) => e.matchCount > 0)
          : false;

        let ordered = enriched;
        if (queryTokens.length && anyLexMatch) {
          ordered = [...enriched].sort((a, b) => {
            if (a.hasAllTerms !== b.hasAllTerms) { return a.hasAllTerms ? -1 : 1; }
            if (a.matchCount !== b.matchCount) { return b.matchCount - a.matchCount; }
            if (a.phraseBoost !== b.phraseBoost) { return b.phraseBoost - a.phraseBoost; }
            return (b.chunk.score ?? 0) - (a.chunk.score ?? 0);
          });
        }

        const top = ordered.slice(0, k);
        const weak = queryTokens.length ? (top[0]?.matchCount ?? 0) === 0 : undefined;

        const results: RagQueryResultItem[] = top.map((e) => ({
          id: e.chunk.chunkId,
          chunkId: e.chunk.chunkId,
          documentId: e.chunk.documentId,
          filename: e.chunk.filename,
          pageStart: e.chunk.pageStart ?? 1,
          pageEnd: e.chunk.pageEnd ?? (e.chunk.pageStart ?? 1),
          score: e.chunk.score,
          source: "upload",
          sourceId: e.chunk.documentId,
          excerpt: excerpt(e.chunk.content, 240),
          meta: {
            filename: e.chunk.filename,
          },
          ...(queryTokens.length
            ? {
                matchCount: e.matchCount,
                matchedTerms: e.matchedTerms,
                hasAllTerms: e.hasAllTerms,
                phraseBoost: e.phraseBoost,
              }
            : {}),
        }));

        return { ok: true, query: q, results, ...(weak !== undefined ? { weak } : {}) };
      } catch (error: unknown) {
        return { ok: false, query: q, results: [], error: toRagError(error) };
      }
    },
  };
}
