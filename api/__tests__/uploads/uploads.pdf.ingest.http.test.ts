import os from "node:os";
import path from "node:path";
import fsp from "node:fs/promises";

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import request from "supertest";
import { PDFDocument, StandardFonts } from "pdf-lib";

import { EMBEDDING_DIM } from "../../../src/server/db/constants.ts";
import { closeDb, getDb, initDb } from "../../../src/server/db/index.ts";

vi.mock("../../../src/server/rag/embeddings/ollama.ts", () => {
  function makeVec(hotIndex: number): number[] {
    const v = new Array<number>(EMBEDDING_DIM).fill(0);
    v[Math.max(0, Math.min(EMBEDDING_DIM - 1, hotIndex))] = 1;
    return v;
  }

  return {
    embedTexts: vi.fn(async (texts: string[]) => {
      return texts.map((_t, i) => makeVec(i));
    }),
    embedQuery: vi.fn(async (text: string) => {
      const t = String(text);
      return makeVec(t.length % EMBEDDING_DIM);
    }),
  };
});

vi.mock("../../../src/server/rag/extract/pdf.ts", async () => {
  const actual = await vi.importActual<typeof import("../../../src/server/rag/extract/pdf.ts")>(
    "../../../src/server/rag/extract/pdf.ts",
  );
  return {
    ...actual,
    extractTextFromPdf: vi.fn(actual.extractTextFromPdf),
  };
});

interface Cleanup {
  uploadsDir: string;
  dbDir: string;
  dbPath: string;
}

async function makeTempDir(prefix: string): Promise<string> {
  return fsp.mkdtemp(path.join(os.tmpdir(), prefix));
}

async function rmDirSafe(dir: string | undefined): Promise<void> {
  if (!dir) { return; }
  try {
    await fsp.rm(dir, { recursive: true, force: true });
  } catch {
    // ignore
  }
}

async function makeOnePagePdf(text: string): Promise<Buffer> {
  const pdfDoc = await PDFDocument.create();
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const page = pdfDoc.addPage();
  page.drawText(text, { x: 50, y: 700, font, size: 18 });
  const bytes = await pdfDoc.save();
  return Buffer.from(bytes);
}

async function waitForJobDone(app: any, jobId: string, timeoutMs = 5000): Promise<any> {
  const start = Date.now();
  // Poll the in-memory queue status endpoint.
  while (Date.now() - start < timeoutMs) {
    const res = await request(app).get(`/api/rag/ingest/jobs/${encodeURIComponent(jobId)}`);
    if (res.status === 200) {
      const state = String(res.body?.state || "");
      if (state === "done" || state === "failed") {
        return res.body;
      }
    }
    await new Promise((r) => setTimeout(r, 25));
  }
  throw new Error(`Timed out waiting for ingest job ${jobId}`);
}

describe("uploads -> rag ingest (PDF)", () => {
  const originalEnv = process.env;
  let cleanup: Cleanup;

  beforeAll(async () => {
    const uploadsDir = await makeTempDir("theapp-uploads-pdf-");
    const dbDir = await makeTempDir("rag-pdf-db-");
    const dbPath = path.join(dbDir, "rag.sqlite");
    cleanup = { uploadsDir, dbDir, dbPath };

    process.env = { ...originalEnv };
    process.env.UPLOADS_DIR = uploadsDir;
    process.env.RAG_DB_PATH = dbPath;

    initDb({ dbPath });
  });

  afterAll(async () => {
    try {
      closeDb();
    } catch {
      // ignore
    }

    process.env = originalEnv;
    await rmDirSafe(cleanup?.uploadsDir);
    await rmDirSafe(cleanup?.dbDir);
  });

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    delete process.env.DEBUG_RAG_PDF;
  });

  it("uploads a PDF, then ingest triggers extractTextFromPdf and indexes document", async () => {
    const { createApp } = await import("../../app.ts");
    const app = createApp();

    const pdfBuffer = await makeOnePagePdf("Hello PDF");

    const uploadRes = await request(app)
      .post("/api/uploads")
      .attach("file", pdfBuffer, {
        filename: "doc.pdf",
        contentType: "application/pdf",
      });

    expect(uploadRes.status).toBe(200);
    expect(uploadRes.body.ok).toBe(true);
    const uploadId = String(uploadRes.body.upload?.id || "");
    expect(uploadId).toBeTruthy();

    // Trigger ingest (this is the path that performs extraction/indexing for PDFs).
    const ingestRes = await request(app)
      .post(`/api/rag/ingest/${encodeURIComponent(uploadId)}`)
      .send({ userId: "local" });

    expect(ingestRes.status).toBe(200);
    const jobId = String(ingestRes.body.jobId || "");
    expect(jobId).toBeTruthy();

    const status = await waitForJobDone(app, jobId, 10_000);
    expect(String(status.state)).toBe("done");
    expect(Number(status.result?.chunksInserted || 0)).toBeGreaterThan(0);

    // Assert the PDF extractor was invoked.
    const pdfMod = await import("../../../src/server/rag/extract/pdf.ts");
    const extractMock = pdfMod.extractTextFromPdf as any;
    expect(extractMock).toHaveBeenCalled();

    // Assert the document status is indexed and has non-empty chunk content.
    const db = getDb();
    const docRow = db.prepare("SELECT status FROM documents WHERE id = ?").get(uploadId) as any;
    expect(String(docRow?.status || "")).toBe("indexed");

    const chunkRow = db
      .prepare("SELECT content FROM chunks WHERE documentId = ? ORDER BY chunkIndex LIMIT 50")
      .all(uploadId) as any[];
    expect(chunkRow.length).toBeGreaterThan(0);
    expect(chunkRow.some((r) => String(r?.content || "").includes("Hello PDF"))).toBe(true);

    // Sanity: the extractor got a Buffer.
    const firstCallArg = extractMock.mock.calls[0]?.[0] as any;
    expect(Buffer.isBuffer(firstCallArg)).toBe(true);
  });
});
