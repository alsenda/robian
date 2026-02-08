import express from "express";
import multer from "multer";
import { randomUUID } from "node:crypto";

import { validateUploadOrThrow, sanitizeFilename, getMaxBytes } from "./security/validateUpload.ts";
import { detectType } from "./parsing/detectType.ts";
import { extractPreviewText } from "./parsing/textExtract.stub.ts";
import { writeStoredFile, deleteStoredFile, createDownloadStream } from "./storage/localStorage.ts";
import { enqueueUploadIngestJob } from "../rag/enqueueUploadIngest.ts";
import {
  addManifestEntry,
  deleteManifestEntry,
  getManifestEntry,
  listManifestEntries,
} from "./db/manifest.ts";

import type { RagService, RagDocumentInput } from "../rag/types.ts";

export interface CreateUploadsRouterDeps {
  rag: RagService;
}

const RAG_TEXT_MIME_TYPES = new Set(["text/plain", "text/markdown", "application/json", "text/csv"]);

function parseBoolEnv(name: string): boolean | null {
  const raw = process.env[name];
  if (raw == null) { return null; }
  const v = String(raw).trim().toLowerCase();
  if (["1", "true", "yes", "y", "on"].includes(v)) { return true; }
  if (["0", "false", "no", "n", "off"].includes(v)) { return false; }
  return null;
}

function shouldAutoIngestPdfOnUpload(): boolean {
  const explicit = parseBoolEnv("AUTO_INGEST_PDF_ON_UPLOAD");
  if (explicit !== null) { return explicit; }

  // Default: enabled in non-prod (dev/test), disabled in prod unless explicitly enabled.
  return process.env.NODE_ENV !== "production";
}

function hasPdfMagicBytes(buffer: unknown): boolean {
  try {
    const b = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer as any);
    return b.length >= 4 && b[0] === 0x25 && b[1] === 0x50 && b[2] === 0x44 && b[3] === 0x46; // "%PDF"
  } catch {
    return false;
  }
}

function isPdfUpload(args: {
  originalName: string;
  mimeTypeSeen?: string;
  detectedMimeType?: string;
  buffer: unknown;
}): boolean {
  const name = String(args.originalName || "");
  const seen = String(args.mimeTypeSeen || "").toLowerCase().trim();
  const detected = String(args.detectedMimeType || "").toLowerCase().trim();

  if (seen === "application/pdf" || detected === "application/pdf") { return true; }
  if (/\.pdf$/i.test(name)) { return true; }
  if (hasPdfMagicBytes(args.buffer)) { return true; }
  return false;
}

function isDebugRagPdfEnabled(): boolean {
  const raw = String(process.env.DEBUG_RAG_PDF || "").trim().toLowerCase();
  return raw === "1" || raw === "true" || raw === "yes";
}

function debugRagPdf(event: string, data: Record<string, unknown>): void {
  if (!isDebugRagPdfEnabled()) { return; }
  try {
    // Single-line JSON for easy grepping; never include document contents.
    console.log(JSON.stringify({ tag: "rag_pdf", scope: "api.uploads", event, ...data }));
  } catch {
    // ignore
  }
}

function parseIntEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  const n = raw ? Number(raw) : NaN;
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}

function isNotImplementedError(result: { error?: { kind?: string } } | null | undefined): boolean {
  return Boolean(result?.error?.kind === "not_implemented");
}

async function bestEffortUpsertToRag({
  rag,
  doc,
}: {
  rag: RagService
  doc: RagDocumentInput,
}): Promise<void> {
  try {
    const out = await rag.upsertDocuments([doc]);
    if (isNotImplementedError(out)) {
      if (process.env.NODE_ENV !== "production" && process.env.NODE_ENV !== "test") {
        console.log("[uploads] RAG upsert skipped (not implemented)");
      }
      return;
    }

    if (!out.ok && process.env.NODE_ENV !== "production" && process.env.NODE_ENV !== "test") {
      console.log("[uploads] RAG upsert failed");
    }
  } catch (error: unknown) {
    if (process.env.NODE_ENV !== "production" && process.env.NODE_ENV !== "test") {
      const message = error instanceof Error ? error.message : "unknown error";
      console.log(`[uploads] RAG upsert threw: ${message}`);
    }
  }
}

async function bestEffortDeleteFromRag({ rag, id }: { rag: RagService; id: string }): Promise<void> {
  try {
    const out = await rag.deleteDocuments([id]);
    if (isNotImplementedError(out)) {
      if (process.env.NODE_ENV !== "production" && process.env.NODE_ENV !== "test") {
        console.log("[uploads] RAG delete skipped (not implemented)");
      }
      return;
    }
    if (!out.ok && process.env.NODE_ENV !== "production" && process.env.NODE_ENV !== "test") {
      console.log("[uploads] RAG delete failed");
    }
  } catch (error: unknown) {
    if (process.env.NODE_ENV !== "production" && process.env.NODE_ENV !== "test") {
      const message = error instanceof Error ? error.message : "unknown error";
      console.log(`[uploads] RAG delete threw: ${message}`);
    }
  }
}

export function createUploadsRouter(deps: CreateUploadsRouterDeps): express.Router {
  const rag = deps.rag;

  const upload = multer({
    storage: multer.memoryStorage(),
    limits: {
      fileSize: getMaxBytes(),
    },
  });

  const uploadsRouter = express.Router();

  uploadsRouter.post("/", upload.single("file"), async (req, res) => {
    try {
      const file = req.file;
      if (!file) {
        return res
          .status(400)
          .json({ ok: false, error: { message: 'Missing multipart file field "file"' } });
      }

      debugRagPdf("upload_received", {
        originalName: file.originalname,
        mimeTypeSeen: file.mimetype,
        sizeBytes: file.size,
        bufferIsBuffer: Buffer.isBuffer(file.buffer),
        bufferType: (file.buffer as any)?.constructor?.name,
        bufferByteLength: (file.buffer as any)?.byteLength,
        bufferLength: (file.buffer as any)?.length,
      });

      validateUploadOrThrow({
        originalName: file.originalname,
        mimeType: file.mimetype,
        sizeBytes: file.size,
      });

      const id = randomUUID();
      const typeInfo = detectType({ originalName: file.originalname, mimeType: file.mimetype });

      debugRagPdf("type_detected", {
        id,
        originalName: file.originalname,
        mimeTypeSeen: file.mimetype,
        detectedMimeType: typeInfo.mimeType,
        extension: typeInfo.extension,
      });

      const preview = extractPreviewText({
        buffer: file.buffer,
        extension: typeInfo.extension,
        maxChars: 20_000,
      });

      const stored = await writeStoredFile({
        id,
        extension: typeInfo.extension,
        buffer: file.buffer,
      });

      const createdAt = new Date().toISOString();

      const entry = {
        id,
        originalName: sanitizeFilename(file.originalname),
        storedName: stored.storedName,
        mimeType: typeInfo.mimeType,
        sizeBytes: file.size,
        createdAt,
        sha256: stored.sha256,
        extension: typeInfo.extension,
        extractable: preview.extractable,
        previewText: preview.previewText,
      };

      await addManifestEntry(entry);

      // Auto-ingest PDFs on upload (async, best-effort).
      // This schedules the existing ingest queue worker (same as POST /api/rag/ingest/:documentId)
      // so PDFs become searchable without a separate client call.
      const autoIngestEnabled = shouldAutoIngestPdfOnUpload();
      const looksPdf = isPdfUpload({
        originalName: file.originalname,
        mimeTypeSeen: file.mimetype,
        detectedMimeType: typeInfo.mimeType,
        buffer: file.buffer,
      });

      let ragInfo: { status: "queued"; jobId: string } | { status: "not_queued"; reason: string } | undefined;

      if (looksPdf) {
        if (!autoIngestEnabled) {
          ragInfo = { status: "not_queued", reason: "AUTO_INGEST_PDF_ON_UPLOAD disabled" };
          debugRagPdf("auto_ingest_skipped", { id, reason: ragInfo.reason });
        } else {
          try {
            const userId = String((req.body as any)?.userId || "local").trim() || "local";
            const jobId = enqueueUploadIngestJob({
              userId,
              documentId: id,
              filename: entry.originalName || entry.storedName,
              mimeType: entry.mimeType,
              filePath: stored.path,
            });
            ragInfo = { status: "queued", jobId };
            debugRagPdf("auto_ingest_enqueued", { id, jobId, userId, filePath: stored.path });
          } catch (error: unknown) {
            const message = error instanceof Error ? error.message : String(error ?? "unknown error");
            ragInfo = { status: "not_queued", reason: message };
            debugRagPdf("auto_ingest_failed", { id, reason: message });
          }
        }
      }

      // DIAGNOSIS (2026-02): PDF uploads are persisted (manifest + stored file) but are NOT
      // extracted/indexed from this endpoint. Only small text-like uploads are best-effort
      // upserted here. PDFs require an explicit ingestion trigger via POST /api/rag/ingest/:documentId
      // which reads the stored file and runs extractTextFromUpload() -> extractTextFromPdf(buffer).
      // Use DEBUG_RAG_PDF=true to confirm the branch taken.
      // Best-effort RAG upsert for plain-text extractable mime types only.
      if (RAG_TEXT_MIME_TYPES.has(String(typeInfo.mimeType || "").toLowerCase())) {
        debugRagPdf("rag_upsert_eligible", {
          id,
          detectedMimeType: typeInfo.mimeType,
          reason: "text_like_mime",
        });
        const maxChars = parseIntEnv("RAG_MAX_TEXT_CHARS_PER_DOC", 200_000);
        const text = Buffer.from(file.buffer).toString("utf8").slice(0, maxChars);
        const doc: RagDocumentInput = {
          id,
          source: "upload",
          sourceId: id,
          title: entry.originalName,
          text,
          mimeType: entry.mimeType,
          createdAt,
          meta: {
            sha256: entry.sha256,
            storedName: entry.storedName,
            sizeBytes: entry.sizeBytes,
            extension: entry.extension,
          },
        };

        void bestEffortUpsertToRag({ rag, doc });
      } else {
        debugRagPdf("rag_upsert_skipped", {
          id,
          detectedMimeType: typeInfo.mimeType,
          reason: "non_text_like_mime_requires_explicit_ingest",
        });
      }

      return res.status(200).json({
        ok: true,
        upload: entry,
        ...(ragInfo ? { rag: ragInfo } : {}),
      });
    } catch (error: unknown) {
      const err = error as { code?: string; message?: string } | null;
      // Multer file size errors
      if (err && typeof err === "object" && err.code === "LIMIT_FILE_SIZE") {
        return res.status(413).json({ ok: false, error: { message: "File too large" } });
      }
      const message = (err && typeof err === "object" && err.message) || "Upload failed";
      return res.status(400).json({ ok: false, error: { message } });
    }
  });

  uploadsRouter.get("/", async (_req, res) => {
    const entries = await listManifestEntries();
    res.status(200).json({ ok: true, uploads: entries });
  });

  uploadsRouter.get("/:id", async (req, res) => {
    const { id } = req.params;
    const entry = await getManifestEntry(id);
    if (!entry) {
      return res.status(404).json({ ok: false, error: { message: "Not found" } });
    }
    return res.status(200).json({
      ok: true,
      upload: entry,
      downloadUrl: `/api/uploads/${encodeURIComponent(id)}/download`,
    });
  });

  uploadsRouter.get("/:id/download", async (req, res) => {
    const { id } = req.params;
    const entry = await getManifestEntry(id);
    if (!entry) {
      return res.status(404).json({ ok: false, error: { message: "Not found" } });
    }

    const stream = await createDownloadStream(entry);
    res.status(200);
    res.setHeader("Content-Type", entry.mimeType || "application/octet-stream");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="${encodeURIComponent(entry.originalName || entry.storedName)}"`,
    );

    stream.on("error", () => {
      try {
        res.status(500).end("Download failed");
      } catch {
        // ignore
      }
    });

    stream.pipe(res);
  });

  uploadsRouter.delete("/:id", async (req, res) => {
    const { id } = req.params;
    const entry = await getManifestEntry(id);
    if (!entry) {
      return res.status(404).json({ ok: false, error: { message: "Not found" } });
    }

    await deleteStoredFile(entry);
    await deleteManifestEntry(id);

    void bestEffortDeleteFromRag({ rag, id });

    return res.status(200).json({ ok: true });
  });

  // Multer (and other) middleware errors
  uploadsRouter.use((err: unknown, _req: unknown, res: express.Response, _next: unknown) => {
    const e = err as { code?: string; message?: string } | null;
    if (e && typeof e === "object" && e.code === "LIMIT_FILE_SIZE") {
      return res.status(413).json({ ok: false, error: { message: "File too large" } });
    }
    const message = (e && typeof e === "object" && e.message) || "Upload failed";
    return res.status(400).json({ ok: false, error: { message } });
  });

  return uploadsRouter;
}
