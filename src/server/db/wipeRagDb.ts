import type { Database } from "./types.ts";

export interface WipeRagDbCounts {
  chunkVectors: number;
  chunks: number;
  documents: number;
  ingestStatus: number;
}

function asChanges(res: unknown): number {
  const changes = (res as { changes?: unknown } | null | undefined)?.changes;
  return typeof changes === "number" && Number.isFinite(changes) ? Math.max(0, Math.floor(changes)) : 0;
}

/**
 * Deletes all RAG content from the sqlite-vec vector store.
 * Safe + explicit: only touches known RAG tables.
 */
export function wipeRagDb(db: Database): WipeRagDbCounts {
  const tx = db.transaction(() => {
    // vec0 has no FK constraints; delete it first.
    const chunkVectors = asChanges(db.prepare("DELETE FROM chunk_vectors").run());
    const chunks = asChanges(db.prepare("DELETE FROM chunks").run());
    const documents = asChanges(db.prepare("DELETE FROM documents").run());

    // Not strictly RAG retrieval content, but part of the ingestion subsystem.
    const ingestStatus = asChanges(db.prepare("DELETE FROM ingest_status").run());

    return { chunkVectors, chunks, documents, ingestStatus } satisfies WipeRagDbCounts;
  });

  return tx();
}
