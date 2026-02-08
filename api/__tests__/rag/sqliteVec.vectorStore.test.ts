import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterAll, describe, expect, it } from "vitest";

import { closeDb, getDb, initDb } from "../../../src/server/db/index.ts";
import { EMBEDDING_DIM } from "../../../src/server/db/constants.ts";
import { insertChunks, upsertChunkVectors, upsertDocument, vectorSearch } from "../../../src/server/rag/vectorStore.ts";

function tempDbPath(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sqlite-vec-test-"));
  return path.join(dir, "vec.sqlite");
}

function makeVector(hotIndex: number): number[] {
  const v = new Array<number>(EMBEDDING_DIM).fill(0);
  v[hotIndex] = 1;
  return v;
}

describe("sqlite-vec vectorStore", () => {
  const dbPath = tempDbPath();
  process.env.RAG_DB_PATH = dbPath;

  afterAll(() => {
    closeDb();
  });

  it("returns nearest chunk by vector similarity", () => {
    initDb();
    const db = getDb();

    const doc = upsertDocument({
      userId: "u1",
      filename: "a.txt",
      sha256: "abc",
      status: "uploaded",
      mimeType: "text/plain",
      byteSize: 3,
    }, db);

    insertChunks(
      [
        { id: "chunk-1", documentId: doc.id, chunkIndex: 0, content: "first", pageStart: 1, pageEnd: 1 },
        { id: "chunk-2", documentId: doc.id, chunkIndex: 1, content: "second", pageStart: 1, pageEnd: 1 },
        { id: "chunk-3", documentId: doc.id, chunkIndex: 2, content: "third", pageStart: 2, pageEnd: 2 },
      ],
      db,
    );

    const v1 = makeVector(0);
    const v2 = makeVector(1);
    const v3 = makeVector(2);

    upsertChunkVectors(
      [
        { chunkId: "chunk-1", embedding: v1 },
        { chunkId: "chunk-2", embedding: v2 },
        { chunkId: "chunk-3", embedding: v3 },
      ],
      db,
    );

    const q = makeVector(1);
    q[0] = 0.01;

    const results = vectorSearch(q, { userId: "u1", topK: 3 }, db);
    expect(results.length).toBeGreaterThan(0);
    expect(results[0]?.chunkId).toBe("chunk-2");
  });
});
