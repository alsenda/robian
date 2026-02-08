import express from "express";
import path from "node:path";

import { getManifestEntry } from "../uploads/db/manifest.ts";
import { getUploadsRootDir, safeJoin } from "../uploads/storage/paths.ts";

import { getIngestJobStatus } from "../../src/server/rag/ingest/queue.ts";
import { enqueueUploadIngestFromManifest } from "./enqueueUploadIngest.ts";

function isDebugRagPdfEnabled(): boolean {
  const raw = String(process.env.DEBUG_RAG_PDF || "").trim().toLowerCase();
  return raw === "1" || raw === "true" || raw === "yes";
}

function debugRagPdf(event: string, data: Record<string, unknown>): void {
  if (!isDebugRagPdfEnabled()) { return; }
  try {
    console.log(JSON.stringify({ tag: "rag_pdf", scope: "api.rag.ingest", event, ...data }));
  } catch {
    // ignore
  }
}

export function createRagIngestRouter(): express.Router {
  const router = express.Router();

  // POST /api/rag/ingest/:documentId -> { jobId }
  router.post("/:documentId", async (req, res) => {
    const documentId = String(req.params.documentId || "").trim();
    if (!documentId) {
      return res.status(400).json({ ok: false, error: { message: "Missing documentId" } });
    }

    const userId = String((req.body as any)?.userId || "local").trim() || "local";

    const entry = await getManifestEntry(documentId);
    if (!entry) {
      return res.status(404).json({ ok: false, error: { message: "Upload not found" } });
    }

    const root = getUploadsRootDir();
    const filePath = safeJoin(root, entry.storedName);

    debugRagPdf("ingest_requested", {
      documentId,
      userId,
      filename: entry.originalName || entry.storedName,
      mimeType: entry.mimeType,
      storedName: entry.storedName,
      filePath,
      sizeBytes: entry.sizeBytes,
      extension: entry.extension,
    });

    // Extra sanity: ensure extension matches storedName.
    const ext = path.extname(entry.storedName || "");
    if (!ext) {
      return res.status(400).json({ ok: false, error: { message: "Upload is missing stored extension" } });
    }

    const enq = await enqueueUploadIngestFromManifest({ userId, documentId });
    if (!enq.ok) {
      return res.status(400).json({ ok: false, error: { message: enq.reason } });
    }

    debugRagPdf("ingest_enqueued", {
      jobId: enq.jobId,
      documentId,
      mimeType: entry.mimeType,
      filePath,
    });

    return res.status(200).json({ jobId: enq.jobId });
  });

  // GET /api/rag/ingest/jobs/:jobId
  router.get("/jobs/:jobId", async (req, res) => {
    const jobId = String(req.params.jobId || "").trim();
    if (!jobId) {
      return res.status(400).json({ ok: false, error: { message: "Missing jobId" } });
    }

    const status = getIngestJobStatus(jobId);
    if (!status) {
      return res.status(404).json({ ok: false, error: { message: "Job not found" } });
    }

    return res.status(200).json(status);
  });

  return router;
}
