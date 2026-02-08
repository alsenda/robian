import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { EMBEDDING_DIM } from "../../../src/server/db/constants.ts";
import { closeDb, getDb, initDb } from "../../../src/server/db/index.ts";
import { wipeRagDb } from "../../../src/server/db/wipeRagDb.ts";
import { insertChunks, upsertChunkVectors, upsertDocument } from "../../../src/server/rag/vectorStore.ts";

function makeVector(hotIndex: number): number[] {
  const v = new Array<number>(EMBEDDING_DIM).fill(0);
  v[Math.max(0, Math.min(EMBEDDING_DIM - 1, hotIndex))] = 1;
  return v;
}

vi.mock("../../../src/server/rag/embeddings/ollama.ts", () => {
  return {
    embedTexts: vi.fn(async (_texts: string[]) => {
      return [];
    }),
    embedQuery: vi.fn(async (_text: string) => {
      // Always return the same query vector so we can make
      // vector similarity prefer the python chunk.
      return makeVector(0);
    }),
  };
});

describe("hybrid RAG search rerank (lexical)", () => {
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

  it("ranks chunks that mention query terms above pure vector matches", async () => {
    const { createVectorStoreRagService } = await import("../../rag/vectorStoreRagService.ts");

    const db = getDb();

    // Create two docs: a Don Quixote PDF and a Python tutorial.
    const quixoteDoc = upsertDocument(
      {
        userId: "local",
        filename: "Don_Quixote.pdf",
        sha256: "sha-quixote",
        status: "indexed",
        mimeType: "application/pdf",
        byteSize: 123,
      },
      db,
    );

    const pythonDoc = upsertDocument(
      {
        userId: "local",
        filename: "Tutorial_Python.pdf",
        sha256: "sha-python",
        status: "indexed",
        mimeType: "application/pdf",
        byteSize: 456,
      },
      db,
    );

    insertChunks(
      [
        {
          id: "chunk-quixote",
          documentId: quixoteDoc.id,
          chunkIndex: 0,
          content: "In Don Quixote, the knight-errant travels with Sancho Panza.",
          pageStart: 1,
          pageEnd: 1,
        },
        {
          id: "chunk-python",
          documentId: pythonDoc.id,
          chunkIndex: 0,
          content: "The Python interpreter executes bytecode. This tutorial explains syntax.",
          pageStart: 1,
          pageEnd: 1,
        },
      ],
      db,
    );

    // Make vector similarity prefer the python chunk.
    upsertChunkVectors(
      [
        { chunkId: "chunk-python", embedding: makeVector(0) },
        { chunkId: "chunk-quixote", embedding: makeVector(1) },
      ],
      db,
    );

    const rag = createVectorStoreRagService();

    const out = await rag.query("Don Quixote", 1, { source: "upload" });
    expect(out.ok).toBe(true);
    expect(out.results.length).toBe(1);

    // Should return the Don Quixote chunk first after lexical rerank.
    expect(out.results[0]?.filename).toBe("Don_Quixote.pdf");
    expect(out.results[0]?.matchCount).toBeGreaterThan(0);
    expect(out.weak).toBe(false);
  });

  it("still ranks python-related queries to python chunks", async () => {
    const { createVectorStoreRagService } = await import("../../rag/vectorStoreRagService.ts");

    const db = getDb();

    const quixoteDoc = upsertDocument(
      {
        userId: "local",
        filename: "Don_Quixote.pdf",
        sha256: "sha-quixote-2",
        status: "indexed",
        mimeType: "application/pdf",
        byteSize: 123,
      },
      db,
    );

    const pythonDoc = upsertDocument(
      {
        userId: "local",
        filename: "Tutorial_Python.pdf",
        sha256: "sha-python-2",
        status: "indexed",
        mimeType: "application/pdf",
        byteSize: 456,
      },
      db,
    );

    insertChunks(
      [
        {
          id: "chunk-quixote-2",
          documentId: quixoteDoc.id,
          chunkIndex: 0,
          content: "In Don Quixote, the knight-errant travels with Sancho Panza.",
          pageStart: 1,
          pageEnd: 1,
        },
        {
          id: "chunk-python-2",
          documentId: pythonDoc.id,
          chunkIndex: 0,
          content: "The Python interpreter executes bytecode. This tutorial explains syntax.",
          pageStart: 1,
          pageEnd: 1,
        },
      ],
      db,
    );

    upsertChunkVectors(
      [
        { chunkId: "chunk-python-2", embedding: makeVector(0) },
        { chunkId: "chunk-quixote-2", embedding: makeVector(1) },
      ],
      db,
    );

    const rag = createVectorStoreRagService();

    const out = await rag.query("Python interpreter", 1, { source: "upload" });
    expect(out.ok).toBe(true);
    expect(out.results.length).toBe(1);

    expect(out.results[0]?.filename).toBe("Tutorial_Python.pdf");
    expect(out.results[0]?.matchCount).toBeGreaterThan(0);
    expect(out.weak).toBe(false);
  });

  it("marks results weak when no lexical matches exist", async () => {
    const { createVectorStoreRagService } = await import("../../rag/vectorStoreRagService.ts");

    const db = getDb();

    const doc = upsertDocument(
      {
        userId: "local",
        filename: "Tutorial_Python.pdf",
        sha256: "sha-python-3",
        status: "indexed",
        mimeType: "application/pdf",
        byteSize: 456,
      },
      db,
    );

    insertChunks(
      [
        {
          id: "chunk-python-3",
          documentId: doc.id,
          chunkIndex: 0,
          content: "The Python interpreter executes bytecode.",
          pageStart: 1,
          pageEnd: 1,
        },
      ],
      db,
    );

    upsertChunkVectors([{ chunkId: "chunk-python-3", embedding: makeVector(0) }], db);

    const rag = createVectorStoreRagService();

    const out = await rag.query("Zyzzyva", 1, { source: "upload" });
    expect(out.ok).toBe(true);
    expect(out.results.length).toBe(1);
    expect(out.results[0]?.matchCount).toBe(0);
    expect(out.weak).toBe(true);
  });
});
