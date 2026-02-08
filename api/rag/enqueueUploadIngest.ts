import path from "node:path";

import { getManifestEntry } from "../uploads/db/manifest.ts";
import { getUploadsRootDir, safeJoin } from "../uploads/storage/paths.ts";

import { enqueueIngest } from "../../src/server/rag/ingest/queue.ts";
import { upsertIngestStatus } from "../../src/server/rag/ingest/statusStore.ts";

export interface EnqueueUploadIngestJobInput {
  userId: string;
  documentId: string;
  filename: string;
  mimeType?: string;
  filePath: string;
}

/**
 * Shared enqueue helper used by both the ingest route and the upload handler.
 * This does not perform extraction itself; it just schedules the existing async ingest worker.
 */
export function enqueueUploadIngestJob(input: EnqueueUploadIngestJobInput): string {
  const jobId = enqueueIngest({
    userId: input.userId,
    documentId: input.documentId,
    filename: input.filename,
    ...(typeof input.mimeType === "string" ? { mimeType: input.mimeType } : {}),
    filePath: input.filePath,
  });

  // Persist queued status for UI.
  upsertIngestStatus({
    documentId: input.documentId,
    userId: input.userId,
    status: "queued",
    jobId,
    lastError: null,
  });

  return jobId;
}

/**
 * Convenience helper for cases where you only have a documentId (upload id).
 * Looks up the stored file in the uploads manifest and enqueues the job.
 */
export async function enqueueUploadIngestFromManifest(args: {
  userId: string;
  documentId: string;
}): Promise<{ ok: true; jobId: string } | { ok: false; reason: string }> {
  const documentId = String(args.documentId || "").trim();
  const userId = String(args.userId || "").trim() || "local";

  if (!documentId) {
    return { ok: false, reason: "Missing documentId" };
  }

  const entry = await getManifestEntry(documentId);
  if (!entry) {
    return { ok: false, reason: "Upload not found" };
  }

  const root = getUploadsRootDir();
  const filePath = safeJoin(root, entry.storedName);

  // Extra sanity: ensure extension matches storedName.
  const ext = path.extname(entry.storedName || "");
  if (!ext) {
    return { ok: false, reason: "Upload is missing stored extension" };
  }

  const jobId = enqueueUploadIngestJob({
    userId,
    documentId,
    filename: entry.originalName || entry.storedName,
    mimeType: entry.mimeType,
    filePath,
  });

  return { ok: true, jobId };
}
