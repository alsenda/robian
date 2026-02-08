import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

describe("RAG degraded messaging (TS)", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    process.env = { ...originalEnv, NODE_ENV: "test" };
    delete process.env.RAG_PROVIDER;
    delete process.env.RAG_DB_PATH;
  });

  afterEach(() => {
    process.env = originalEnv;
    vi.unmock("../../../src/server/db/index.ts");
  });

  it("returns sanitized db_unavailable message when sqlite init fails", async () => {
    // createRagService() is backed by src/server/db initDb().
    vi.doMock("../../../src/server/db/index.ts", async () => {
      const actual = await vi.importActual<typeof import("../../../src/server/db/index.ts")>("../../../src/server/db/index.ts");
      return {
        ...actual,
        initDb: vi.fn(() => {
          throw new Error("Failed to load better-sqlite3: missing native bindings");
        }),
      };
    });

    const { createRagService } = await import("../../rag/index.ts");
    const rag = createRagService({ provider: "sqlite" });

    const out = await rag.query("hello");
    expect(out.ok).toBe(false);
    expect(out.error?.kind).toBe("db_unavailable");
    expect(String(out.error?.message || "")).toContain("RAG storage is unavailable");
    expect(String(out.error?.message || "")).not.toMatch(/better-sqlite3/i);
  });
});
