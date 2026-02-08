import { randomUUID } from "node:crypto";

import { EMBEDDING_DIM } from "../db/constants.ts";
import { getDb } from "../db/index.ts";
import type { Database } from "../db/types.ts";

export interface DocumentInput {
  id?: string;
  userId: string;
  filename: string;
  mimeType?: string;
  byteSize?: number;
  sha256: string;
  createdAt?: number;
  status: "uploaded" | "indexed" | "failed";
}

export interface DocumentRow {
  id: string;
  userId: string;
  filename: string;
  mimeType: string | null;
  byteSize: number | null;
  sha256: string;
  createdAt: number;
  status: string;
}

export interface ChunkInput {
  id?: string;
  documentId: string;
  chunkIndex: number;
  content: string;
  pageStart?: number;
  pageEnd?: number;
  charStart?: number;
  charEnd?: number;
  createdAt?: number;
}

export interface ChunkRow {
  id: string;
  documentId: string;
  chunkIndex: number;
  content: string;
  pageStart: number | null;
  pageEnd: number | null;
  createdAt: number;
}

export interface ChunkVectorInput {
  chunkId: string;
  embedding: number[];
}

export interface VectorSearchOpts {
  userId: string;
  docIds?: string[];
  topK: number;
}

export interface VectorSearchResult {
  chunkId: string;
  documentId: string;
  filename: string;
  pageStart: number | null;
  pageEnd: number | null;
  content: string;
  score: number;
}

function assertEmbedding(embedding: number[]): void {
  if (!Array.isArray(embedding)) { throw new Error("Embedding must be an array"); }
  if (embedding.length !== EMBEDDING_DIM) {
    throw new Error(`Embedding dim mismatch: expected ${EMBEDDING_DIM}, got ${embedding.length}`);
  }
  for (const v of embedding) {
    if (typeof v !== "number" || !Number.isFinite(v)) {
      throw new Error("Embedding contains non-finite number");
    }
  }
}

export function upsertDocument(doc: DocumentInput, db: Database = getDb()): DocumentRow {
  const userId = String(doc.userId);
  const sha256 = String(doc.sha256);
  if (!userId) { throw new Error("userId is required"); }
  if (!sha256) { throw new Error("sha256 is required"); }

  const existing = db
    .prepare(
      "SELECT id, userId, filename, mimeType, byteSize, sha256, createdAt, status FROM documents WHERE userId = ? AND sha256 = ? LIMIT 1",
    )
    .get(userId, sha256) as DocumentRow | undefined;

  if (existing?.id) { return existing; }

  const id = doc.id ? String(doc.id) : randomUUID();
  const createdAt = Number.isFinite(doc.createdAt) ? Math.floor(doc.createdAt as number) : Date.now();
  const filename = String(doc.filename);
  const status = String(doc.status);

  db.prepare(
    "INSERT INTO documents (id, userId, filename, mimeType, byteSize, sha256, createdAt, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
  ).run(
    id,
    userId,
    filename,
    doc.mimeType ? String(doc.mimeType) : null,
    Number.isFinite(doc.byteSize) ? Math.floor(doc.byteSize as number) : null,
    sha256,
    createdAt,
    status,
  );

  const inserted = db
    .prepare(
      "SELECT id, userId, filename, mimeType, byteSize, sha256, createdAt, status FROM documents WHERE id = ? LIMIT 1",
    )
    .get(id) as DocumentRow;

  return inserted;
}

export function insertChunks(chunks: ChunkInput[], db: Database = getDb()): ChunkRow[] {
  const list = Array.isArray(chunks) ? chunks : [];
  if (list.length === 0) { return []; }

  const insertStmt = db.prepare(
    "INSERT OR REPLACE INTO chunks (id, documentId, chunkIndex, content, pageStart, pageEnd, charStart, charEnd, createdAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
  );

  const out: ChunkRow[] = [];

  const tx = db.transaction(() => {
    for (const c of list) {
      const id = c.id ? String(c.id) : randomUUID();
      const documentId = String(c.documentId);
      const chunkIndex = Math.floor(c.chunkIndex);
      const content = String(c.content);
      const createdAt = Number.isFinite(c.createdAt) ? Math.floor(c.createdAt as number) : Date.now();

      insertStmt.run(
        id,
        documentId,
        chunkIndex,
        content,
        Number.isFinite(c.pageStart) ? Math.floor(c.pageStart as number) : null,
        Number.isFinite(c.pageEnd) ? Math.floor(c.pageEnd as number) : null,
        Number.isFinite(c.charStart) ? Math.floor(c.charStart as number) : null,
        Number.isFinite(c.charEnd) ? Math.floor(c.charEnd as number) : null,
        createdAt,
      );

      out.push({
        id,
        documentId,
        chunkIndex,
        content,
        pageStart: Number.isFinite(c.pageStart) ? Math.floor(c.pageStart as number) : null,
        pageEnd: Number.isFinite(c.pageEnd) ? Math.floor(c.pageEnd as number) : null,
        createdAt,
      });
    }
  });

  tx();
  return out;
}

export function upsertChunkVectors(vectors: ChunkVectorInput[], db: Database = getDb()): void {
  const list = Array.isArray(vectors) ? vectors : [];
  if (list.length === 0) { return; }

  const del = db.prepare("DELETE FROM chunk_vectors WHERE chunkId = ?");
  const ins = db.prepare("INSERT INTO chunk_vectors (chunkId, embedding) VALUES (?, vec_normalize(vec_f32(?)))");

  const tx = db.transaction(() => {
    for (const v of list) {
      const chunkId = String(v.chunkId);
      if (!chunkId) { throw new Error("chunkId is required"); }
      assertEmbedding(v.embedding);

      del.run(chunkId);
      ins.run(chunkId, JSON.stringify(v.embedding));
    }
  });

  tx();
}

export function vectorSearch(
  queryEmbedding: number[],
  opts: VectorSearchOpts,
  db: Database = getDb(),
): VectorSearchResult[] {
  assertEmbedding(queryEmbedding);

  const userId = String(opts.userId);
  const topK = Number.isFinite(opts.topK) && opts.topK > 0 ? Math.floor(opts.topK) : 5;
  const docIds = Array.isArray(opts.docIds) ? opts.docIds.map((d) => String(d)).filter(Boolean) : [];

  const docFilterSql = docIds.length ? ` AND d.id IN (${docIds.map(() => "?").join(",")})` : "";
  const params: unknown[] = [userId, JSON.stringify(queryEmbedding), topK, ...docIds, topK];

  const sql =
    `SELECT ` +
    `  v.chunkId AS chunkId, ` +
    `  c.documentId AS documentId, ` +
    `  d.filename AS filename, ` +
    `  c.pageStart AS pageStart, ` +
    `  c.pageEnd AS pageEnd, ` +
    `  c.content AS content, ` +
    `  (1.0 - (v.distance * v.distance) / 2.0) AS score ` +
    `FROM chunk_vectors v ` +
    `JOIN chunks c ON c.id = v.chunkId ` +
    `JOIN documents d ON d.id = c.documentId ` +
    `WHERE d.userId = ? ` +
    `  AND v.embedding MATCH vec_normalize(vec_f32(?)) ` +
    `  AND v.k = ? ` +
    docFilterSql +
    ` ORDER BY v.distance ASC ` +
    ` LIMIT ?`;

  const rows = db.prepare(sql).all(...params) as Array<Record<string, unknown>>;

  return rows.map((r) => ({
    chunkId: String(r.chunkId),
    documentId: String(r.documentId),
    filename: String(r.filename),
    pageStart: typeof r.pageStart === "number" ? (Number.isFinite(r.pageStart) ? Math.floor(r.pageStart) : null) : null,
    pageEnd: typeof r.pageEnd === "number" ? (Number.isFinite(r.pageEnd) ? Math.floor(r.pageEnd) : null) : null,
    content: String(r.content),
    score: typeof r.score === "number" && Number.isFinite(r.score) ? r.score : 0,
  }));
}
