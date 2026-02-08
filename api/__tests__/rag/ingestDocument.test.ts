import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { EMBEDDING_DIM } from "../../../src/server/db/constants.ts";
import { closeDb, getDb, initDb } from "../../../src/server/db/index.ts";
import { wipeRagDb } from "../../../src/server/db/wipeRagDb.ts";

vi.mock("../../../src/server/rag/embeddings/ollama.ts", () => {
  function makeVec(hotIndex: number): number[] {
    const v = new Array<number>(EMBEDDING_DIM).fill(0);
    v[Math.max(0, Math.min(EMBEDDING_DIM - 1, hotIndex))] = 1;
    return v;
  }

  return {
    embedTexts: vi.fn(async (texts: string[]) => {
      return texts.map((_t, i) => makeVec(i));
    }),
    embedQuery: vi.fn(async (text: string) => {
      const t = String(text);
      return makeVec(t.length % EMBEDDING_DIM);
    }),
  };
});

describe("ingestDocument", () => {
  beforeAll(() => {
    initDb();
  });

  beforeEach(() => {
    wipeRagDb(getDb());
  });

  afterAll(() => {
    try {
      closeDb();
    } catch {
      // ignore
    }
  });

  it("extracts, chunks, embeds, and writes vectors", async () => {
    const { ingestDocument } = await import("../../../src/server/rag/ingest/ingestDocument.ts");

    const userId = "u1";
    const documentId = "doc-1";

    const buffer = Buffer.from("Hello world. This is a test document for ingestion.", "utf8");

    const out = await ingestDocument({
      userId,
      documentId,
      filename: "a.txt",
      mimeType: "text/plain",
      buffer,
    });

    expect(out.chunksInserted).toBeGreaterThan(0);

    const db = getDb();

    const chunksCount = db
      .prepare("SELECT COUNT(*) AS n FROM chunks WHERE documentId = ?")
      .get(documentId) as any;

    const vecCount = db
      .prepare(
        "SELECT COUNT(*) AS n FROM chunk_vectors WHERE chunkId IN (SELECT id FROM chunks WHERE documentId = ?)",
      )
      .get(documentId) as any;

    const docRow = db
      .prepare("SELECT status FROM documents WHERE id = ?")
      .get(documentId) as any;

    expect(Number(chunksCount?.n || 0)).toBe(out.chunksInserted);
    expect(Number(vecCount?.n || 0)).toBe(out.chunksInserted);
    expect(String(docRow?.status || "")).toBe("indexed");
  });
});
