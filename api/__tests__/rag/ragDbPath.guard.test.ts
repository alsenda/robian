import os from "node:os";
import path from "node:path";

import { describe, expect, it, vi } from "vitest";

describe("RAG DB path guard (tests)", () => {
  it("uses a temp DB path under vitest when RAG_DB_PATH is not set", async () => {
    const original = process.env.RAG_DB_PATH;
    delete process.env.RAG_DB_PATH;

    vi.resetModules();
    const mod = await import("../../../src/server/db/ragDbPath.ts");
    const dbPath = mod.getRagDbPath();
    const def = mod.getDefaultDevProdRagDbPath();

    expect(path.isAbsolute(dbPath)).toBe(true);
    expect(dbPath.toLowerCase()).not.toBe(def.toLowerCase());
    expect(dbPath.toLowerCase().startsWith(os.tmpdir().toLowerCase())).toBe(true);

    if (original != null) {
      process.env.RAG_DB_PATH = original;
    }
  });

  it("throws if tests try to use the dev/prod default DB path", async () => {
    vi.resetModules();
    const mod = await import("../../../src/server/db/ragDbPath.ts");
    const def = mod.getDefaultDevProdRagDbPath();

    const original = process.env.RAG_DB_PATH;
    process.env.RAG_DB_PATH = def;

    vi.resetModules();
    const mod2 = await import("../../../src/server/db/ragDbPath.ts");
    expect(() => mod2.getRagDbPath()).toThrow(/Refusing to use dev\/prod RAG DB path in tests/i);

    if (original != null) {
      process.env.RAG_DB_PATH = original;
    } else {
      delete process.env.RAG_DB_PATH;
    }
  });
});
