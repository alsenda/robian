import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import request from "supertest";

describe("RAG health HTTP API (TS)", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    process.env = { ...originalEnv };
    delete process.env.RAG_PROVIDER;
    delete process.env.RAG_DB_PATH;
    delete process.env.OLLAMA_URL;
    delete process.env.OLLAMA_EMBED_MODEL;
  });

  afterEach(() => {
    process.env = originalEnv;
    vi.unmock("../../rag/sqlite/db.ts");
    vi.unmock("../../embeddings/ollamaEmbeddings.ts");
  });

  it("returns ok:true when provider is sqlite and embeddings are healthy", async () => {
    process.env.RAG_PROVIDER = "sqlite";
    process.env.RAG_DB_PATH = "data/test.sqlite";
    process.env.OLLAMA_URL = "http://localhost:11434";
    process.env.OLLAMA_EMBED_MODEL = "embed-model";

    vi.doMock("../../rag/sqlite/db.ts", async () => {
      const actual = await vi.importActual<typeof import("../../rag/sqlite/db.ts")>("../../rag/sqlite/db.ts");
      return {
        ...actual,
        openSqliteDb: vi.fn(() => ({
          exec: () => void 0,
          prepare: () => ({ run: () => ({ changes: 0 }), all: () => [] }),
          close: () => void 0,
        })),
      };
    });

    vi.doMock("../../embeddings/ollamaEmbeddings.ts", async () => {
      const actual = await vi.importActual<typeof import("../../embeddings/ollamaEmbeddings.ts")>("../../embeddings/ollamaEmbeddings.ts");
      return {
        ...actual,
        createOllamaEmbeddingsService: vi.fn(() => ({
          embedText: async () => [0.1, 0.2, 0.3],
        })),
      };
    });

    const { createApp } = await import("../../app.ts");
    const app = createApp();

    const res = await request(app).get("/api/rag/health");
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.provider).toBe("sqlite");
    expect(res.body.dbPath).toBe("data/test.sqlite");
    expect(res.body.embedModel).toBe("embed-model");
    expect(res.body.error).toBeUndefined();
  });

  it("returns ok:false when embeddings probe throws", async () => {
    process.env.RAG_PROVIDER = "sqlite";
    process.env.RAG_DB_PATH = "data/test.sqlite";
    process.env.OLLAMA_URL = "http://localhost:11434";
    process.env.OLLAMA_EMBED_MODEL = "embed-model";

    vi.doMock("../../rag/sqlite/db.ts", async () => {
      const actual = await vi.importActual<typeof import("../../rag/sqlite/db.ts")>("../../rag/sqlite/db.ts");
      return {
        ...actual,
        openSqliteDb: vi.fn(() => ({
          exec: () => void 0,
          prepare: () => ({ run: () => ({ changes: 0 }), all: () => [] }),
          close: () => void 0,
        })),
      };
    });

    vi.doMock("../../embeddings/ollamaEmbeddings.ts", async () => {
      const actual = await vi.importActual<typeof import("../../embeddings/ollamaEmbeddings.ts")>("../../embeddings/ollamaEmbeddings.ts");
      return {
        ...actual,
        createOllamaEmbeddingsService: vi.fn(() => ({
          embedText: async () => {
            throw { kind: "network", message: "connection refused" };
          },
        })),
      };
    });

    const { createApp } = await import("../../app.ts");
    const app = createApp();
    const res = await request(app).get("/api/rag/health");

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(false);
    expect(res.body.provider).toBe("sqlite");
    expect(res.body.error?.kind).toBe("network");
    expect(String(res.body.error?.message || "")).toMatch(/connection refused|embeddings|network/i);
  });

  it("returns ok:false when provider is stub", async () => {
    process.env.RAG_PROVIDER = "stub";

    const { createApp } = await import("../../app.ts");
    const app = createApp();
    const res = await request(app).get("/api/rag/health");

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(false);
    expect(res.body.provider).toBe("stub");
    expect(res.body.error?.kind).toBe("stubbed");
    expect(String(res.body.error?.message || "")).toMatch(/RAG_PROVIDER=sqlite/i);
  });

  it("returns ok:false with sanitized db_unavailable when db probe fails", async () => {
    process.env.RAG_PROVIDER = "sqlite";
    process.env.RAG_DB_PATH = "data/test.sqlite";

    vi.doMock("../../rag/sqlite/db.ts", async () => {
      const actual = await vi.importActual<typeof import("../../rag/sqlite/db.ts")>("../../rag/sqlite/db.ts");
      return {
        ...actual,
        openSqliteDb: vi.fn(() => {
          throw new Error("Failed to load better-sqlite3 (native module)");
        }),
      };
    });

    const { createApp } = await import("../../app.ts");
    const app = createApp();
    const res = await request(app).get("/api/rag/health");

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(false);
    expect(res.body.provider).toBe("sqlite");
    expect(res.body.error?.kind).toBe("db_unavailable");
    expect(String(res.body.error?.message || "")).toContain("RAG storage is unavailable");
    expect(String(res.body.error?.message || "")).not.toMatch(/better-sqlite3/i);
  });
});
