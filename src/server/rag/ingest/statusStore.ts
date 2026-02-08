import { getDb } from "../../db/index.ts";
import type { Database } from "../../db/types.ts";

export type RagIndexStatus = "uploaded" | "queued" | "indexing" | "indexed" | "failed";

export interface IngestStatusRow {
  documentId: string;
  userId: string;
  status: RagIndexStatus;
  jobId?: string;
  lastError?: string;
  isLikelyScanned?: boolean;
  createdAt: number;
  updatedAt: number;
}

function asBoolInt(v: unknown): boolean | undefined {
  if (v === null || v === undefined) { return undefined; }
  const n = typeof v === "number" ? v : Number(v);
  if (!Number.isFinite(n)) { return undefined; }
  return n !== 0;
}

function asRow(raw: unknown): IngestStatusRow | null {
  if (!raw || typeof raw !== "object") { return null; }
  const r = raw as any;
  const documentId = typeof r.documentId === "string" ? r.documentId : "";
  const userId = typeof r.userId === "string" ? r.userId : "";
  const status = typeof r.status === "string" ? (r.status as RagIndexStatus) : ("uploaded" as RagIndexStatus);
  const jobId = typeof r.jobId === "string" && r.jobId ? r.jobId : undefined;
  const lastError = typeof r.lastError === "string" && r.lastError ? r.lastError : undefined;
  const isLikelyScanned = asBoolInt(r.isLikelyScanned);
  const createdAt = typeof r.createdAt === "number" ? r.createdAt : Number(r.createdAt);
  const updatedAt = typeof r.updatedAt === "number" ? r.updatedAt : Number(r.updatedAt);

  if (!documentId || !userId) { return null; }
  if (!Number.isFinite(createdAt) || !Number.isFinite(updatedAt)) { return null; }

  return {
    documentId,
    userId,
    status,
    ...(jobId ? { jobId } : {}),
    ...(lastError ? { lastError } : {}),
    ...(typeof isLikelyScanned === "boolean" ? { isLikelyScanned } : {}),
    createdAt,
    updatedAt,
  };
}

function db(): Database {
  return getDb();
}

export function getIngestStatus(documentId: string): IngestStatusRow | null {
  const id = String(documentId || "").trim();
  if (!id) { return null; }

  const row = db()
    .prepare(
      "SELECT documentId, userId, status, jobId, lastError, isLikelyScanned, createdAt, updatedAt FROM ingest_status WHERE documentId = ?",
    )
    .get(id);

  return asRow(row);
}

export function getIngestStatusMany(documentIds: string[]): Map<string, IngestStatusRow> {
  const ids = Array.isArray(documentIds) ? documentIds.map((d) => String(d || "").trim()).filter(Boolean) : [];
  const out = new Map<string, IngestStatusRow>();
  if (ids.length === 0) { return out; }

  const placeholders = ids.map(() => "?").join(",");
  const rows = db()
    .prepare(
      `SELECT documentId, userId, status, jobId, lastError, isLikelyScanned, createdAt, updatedAt FROM ingest_status WHERE documentId IN (${placeholders})`,
    )
    .all(...ids);

  for (const r of rows as unknown[]) {
    const parsed = asRow(r);
    if (parsed) { out.set(parsed.documentId, parsed); }
  }
  return out;
}

export function upsertIngestStatus(args: {
  documentId: string;
  userId: string;
  status: RagIndexStatus;
  jobId?: string;
  lastError?: string | null;
  isLikelyScanned?: boolean | null;
}): void {
  const documentId = String(args.documentId || "").trim();
  const userId = String(args.userId || "").trim() || "local";
  const status = args.status;
  if (!documentId) { throw new Error("documentId is required"); }

  const now = Date.now();
  const lastError = status === "failed" ? (args.lastError ? String(args.lastError) : null) : null;
  const isLikelyScanned = args.isLikelyScanned == null ? null : args.isLikelyScanned ? 1 : 0;
  const jobId = args.jobId ? String(args.jobId) : null;

  db().prepare(
    `INSERT INTO ingest_status (documentId, userId, status, jobId, lastError, isLikelyScanned, createdAt, updatedAt)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(documentId) DO UPDATE SET
       userId = excluded.userId,
       status = excluded.status,
       jobId = CASE WHEN excluded.jobId IS NOT NULL THEN excluded.jobId ELSE ingest_status.jobId END,
       lastError = excluded.lastError,
       isLikelyScanned = CASE WHEN excluded.isLikelyScanned IS NOT NULL THEN excluded.isLikelyScanned ELSE ingest_status.isLikelyScanned END,
       updatedAt = excluded.updatedAt`,
  ).run(
    documentId,
    userId,
    status,
    jobId,
    lastError,
    isLikelyScanned,
    now,
    now,
  );
}
