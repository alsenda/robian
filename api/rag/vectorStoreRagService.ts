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

        const chunks = vectorSearch(queryVec, {
          userId: "local",
          topK: k,
          ...(docIds && docIds.length ? { docIds } : {}),
        });

        const results: RagQueryResultItem[] = chunks.map((c) => ({
          id: c.chunkId,
          chunkId: c.chunkId,
          documentId: c.documentId,
          filename: c.filename,
          pageStart: c.pageStart ?? 1,
          pageEnd: c.pageEnd ?? (c.pageStart ?? 1),
          score: c.score,
          source: "upload",
          sourceId: c.documentId,
          excerpt: excerpt(c.content, 240),
          meta: {
            filename: c.filename,
          },
        }));

        return { ok: true, query: q, results };
      } catch (error: unknown) {
        return { ok: false, query: q, results: [], error: toRagError(error) };
      }
    },
  };
}
