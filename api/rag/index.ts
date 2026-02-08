import type { RagService } from "./types.ts";
import { createStubRagService } from "./ragService.stub.ts";

import { createOllamaEmbeddingsService } from "../embeddings/ollamaEmbeddings.ts";
import { createVectorStoreRagService } from "./vectorStoreRagService.ts";

export interface RagServiceConfig {
  provider?: "stub" | "sqlite";
}

function oneLine(input: string): string {
  return String(input || "")
    .replace(/[\r\n\t]+/g, " ")
    .replace(/\s{2,}/g, " ")
    .trim();
}

function describeErrorOneLine(error: unknown): { message: string; code: string | undefined } {
  if (error instanceof Error) {
    const code = (error as { code?: unknown }).code;
    return {
      message: oneLine(error.message || "Error"),
      code: typeof code === "string" && code ? code : undefined,
    };
  }

  if (error && typeof error === "object") {
    const message = (error as { message?: unknown }).message;
    const code = (error as { code?: unknown }).code;
    return {
      message: oneLine(typeof message === "string" ? message : "Error"),
      code: typeof code === "string" && code ? code : undefined,
    };
  }

  return { message: oneLine(String(error ?? "Error")), code: undefined };
}

function createUnavailableRagService(error: { kind: string; message: string }): RagService {
  return {
    async upsertDocuments(_docs) {
      return { ok: false, upserted: 0, error };
    },
    async deleteDocuments(_ids) {
      return { ok: false, deleted: 0, error };
    },
    async query(query: string) {
      return { ok: false, query: String(query ?? ""), results: [], error };
    },
  };
}

export function createRagService(config?: RagServiceConfig): RagService {
  const provider = config?.provider ?? process.env.RAG_PROVIDER ?? "sqlite";

  function parseIntEnv(name: string, fallback: number): number {
    const raw = process.env[name];
    const n = raw ? Number(raw) : NaN;
    return Number.isFinite(n) ? Math.floor(n) : fallback;
  }

  function getOllamaUrl(): string {
    return String(process.env.OLLAMA_URL || "http://localhost:11434").trim().replace(/\/+$/, "");
  }

  function getEmbedModel(): string {
    return String(process.env.OLLAMA_EMBED_MODEL || "robian:latest").trim();
  }

  switch (provider) {
    case "stub":
      return createStubRagService();

    case "sqlite": {
      try {
        // Runtime RAG is backed by the sqlite-vec vector store (documents/chunks/chunk_vectors)
        // so it matches the ingest worker and /api/rag/ask.
        // createOllamaEmbeddingsService is still used by /api/rag/health for embeddings probes.
        void getOllamaUrl();
        void getEmbedModel();
        void createOllamaEmbeddingsService;
        return createVectorStoreRagService();
      } catch (error: unknown) {
        // Best-effort: if sqlite fails, don't crash the server.
        if (process.env.NODE_ENV !== "test") {
          const diag = describeErrorOneLine(error);
          const suffix = diag.code ? ` (code=${diag.code})` : "";
          console.error(`[rag] sqlite unavailable: ${diag.message}${suffix}`);
        }
        return createUnavailableRagService({
          kind: "db_unavailable",
          message:
            "RAG storage is unavailable. Check RAG_DB_PATH, file permissions, and that SQLite can open the database.",
        });
      }
    }

    default:
      return createStubRagService();
  }
}
