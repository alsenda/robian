import fsp from "node:fs/promises";
import { randomUUID } from "node:crypto";

import { ingestDocument } from "./ingestDocument.ts";
import { upsertIngestStatus } from "./statusStore.ts";

export type IngestJobState = "queued" | "running" | "done" | "failed";

export interface EnqueueIngestJob {
  userId: string;
  documentId: string;
  filename: string;
  mimeType?: string;
  filePath: string;
}

export interface IngestJobStatus {
  jobId: string;
  state: IngestJobState;
  documentId: string;
  queuedAt: number;
  startedAt?: number;
  finishedAt?: number;
  result?: { chunksInserted: number };
  error?: string;
}

type InternalJob = EnqueueIngestJob & {
  jobId: string
  queuedAt: number
  state: IngestJobState
  startedAt?: number
  finishedAt?: number
  result?: { chunksInserted: number }
  error?: string,
};

const jobs = new Map<string, InternalJob>();
const queue: string[] = [];
let workerRunning = false;

function isDebugRagPdfEnabled(): boolean {
  const raw = String(process.env.DEBUG_RAG_PDF || "").trim().toLowerCase();
  return raw === "1" || raw === "true" || raw === "yes";
}

function debugRagPdf(event: string, data: Record<string, unknown>): void {
  if (!isDebugRagPdfEnabled()) { return; }
  try {
    console.log(JSON.stringify({ tag: "rag_pdf", scope: "rag.ingest.queue", event, ...data }));
  } catch {
    // ignore
  }
}

function toOneLine(input: string): string {
  return String(input || "")
    .replace(/[\r\n\t]+/g, " ")
    .replace(/\s{2,}/g, " ")
    .trim();
}

async function runWorker(): Promise<void> {
  if (workerRunning) { return; }
  workerRunning = true;

  try {
    while (queue.length) {
      const jobId = queue.shift()!;
      const job = jobs.get(jobId);
      if (!job) { continue; }
      if (job.state !== "queued") { continue; }

      job.state = "running";
      job.startedAt = Date.now();

      try {
        upsertIngestStatus({
          documentId: job.documentId,
          userId: job.userId,
          status: "indexing",
          ...(job.jobId ? { jobId: job.jobId } : {}),
          lastError: null,
        });
      } catch {
        // ignore status persistence errors
      }

      debugRagPdf("job_started", {
        jobId: job.jobId,
        documentId: job.documentId,
        filename: job.filename,
        mimeType: job.mimeType,
        filePath: job.filePath,
      });

      try {
        const buffer = await fsp.readFile(job.filePath);

        debugRagPdf("file_read", {
          jobId: job.jobId,
          documentId: job.documentId,
          bufferIsBuffer: Buffer.isBuffer(buffer),
          bufferType: (buffer as any)?.constructor?.name,
          bufferByteLength: (buffer as any)?.byteLength,
          bufferLength: (buffer as any)?.length,
        });

        const result = await ingestDocument({
          userId: job.userId,
          documentId: job.documentId,
          filename: job.filename,
          ...(typeof job.mimeType === "string" ? { mimeType: job.mimeType } : {}),
          buffer,
        });

        job.state = "done";
        job.result = result;
        job.finishedAt = Date.now();

        debugRagPdf("job_done", {
          jobId: job.jobId,
          documentId: job.documentId,
          result,
        });
      } catch (error: unknown) {
        job.state = "failed";
        job.error = toOneLine(error instanceof Error ? error.message : String(error ?? "unknown error"));
        job.finishedAt = Date.now();

        try {
          upsertIngestStatus({
            documentId: job.documentId,
            userId: job.userId,
            status: "failed",
            ...(job.jobId ? { jobId: job.jobId } : {}),
            lastError: job.error,
          });
        } catch {
          // ignore
        }

        debugRagPdf("job_failed", {
          jobId: job.jobId,
          documentId: job.documentId,
          error: job.error,
        });
      }
    }
  } finally {
    workerRunning = false;
  }
}

export function enqueueIngest(job: EnqueueIngestJob): string {
  const userId = String(job.userId || "").trim();
  const documentId = String(job.documentId || "").trim();
  const filename = String(job.filename || "").trim() || "upload";
  const mimeType = typeof job.mimeType === "string" && job.mimeType ? job.mimeType : undefined;
  const filePath = String(job.filePath || "").trim();

  if (!userId) { throw new Error("userId is required"); }
  if (!documentId) { throw new Error("documentId is required"); }
  if (!filePath) { throw new Error("filePath is required"); }

  const jobId = randomUUID();
  const queuedAt = Date.now();

  const internal: InternalJob = {
    jobId,
    userId,
    documentId,
    filename,
    ...(mimeType ? { mimeType } : {}),
    filePath,
    queuedAt,
    state: "queued",
  };

  jobs.set(jobId, internal);
  queue.push(jobId);

  // Start worker without blocking request path.
  void runWorker();

  return jobId;
}

export function getIngestJobStatus(jobId: string): IngestJobStatus | null {
  const id = String(jobId || "").trim();
  if (!id) { return null; }

  const job = jobs.get(id);
  if (!job) { return null; }

  return {
    jobId: job.jobId,
    state: job.state,
    documentId: job.documentId,
    queuedAt: job.queuedAt,
    ...(typeof job.startedAt === "number" ? { startedAt: job.startedAt } : {}),
    ...(typeof job.finishedAt === "number" ? { finishedAt: job.finishedAt } : {}),
    ...(job.result ? { result: job.result } : {}),
    ...(job.error ? { error: job.error } : {}),
  };
}
