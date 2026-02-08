import type { Database } from "./types.ts";
import { getRagDbPath } from "./ragDbPath.ts";

function isDebugEnabled(): boolean {
  const raw = String(process.env.DEBUG_RAG_DB || "").trim().toLowerCase();
  return raw === "1" || raw === "true" || raw === "yes";
}

function toInt(v: unknown): number {
  return typeof v === "number" && Number.isFinite(v) ? Math.floor(v) : 0;
}

export function debugRagDb(event: string, data: Record<string, unknown>): void {
  if (!isDebugEnabled()) { return; }
  try {
    console.log(JSON.stringify({ tag: "rag_db", event, ...data }));
  } catch {
    // ignore
  }
}

export function debugRagDbCounts(scope: string, db: Database): void {
  if (!isDebugEnabled()) { return; }

  try {
    const docs = db.prepare("SELECT COUNT(*) AS n FROM documents").get() as any;
    const chunks = db.prepare("SELECT COUNT(*) AS n FROM chunks").get() as any;
    const vecs = db.prepare("SELECT COUNT(*) AS n FROM chunk_vectors").get() as any;
    debugRagDb("counts", {
      scope,
      dbPath: getRagDbPath(),
      documents: toInt(docs?.n),
      chunks: toInt(chunks?.n),
      chunkVectors: toInt(vecs?.n),
    });
  } catch {
    // ignore
  }
}
