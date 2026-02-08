import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import request from "supertest";
import os from "node:os";
import path from "node:path";
import fsp from "node:fs/promises";
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

async function makeOnePagePdf(text: string): Promise<Buffer> {
  const pdfDoc = await PDFDocument.create();
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const page = pdfDoc.addPage();
  page.drawText(text, { x: 50, y: 700, font, size: 18 });
  const bytes = await pdfDoc.save();
  return Buffer.from(bytes);
}

async function waitForJobDone(app: any, jobId: string, timeoutMs = 8000): Promise<any> {
  const start = Date.now();
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

async function makeTempDir(): Promise<string> {
  const base = await fsp.mkdtemp(path.join(os.tmpdir(), "theapp-uploads-"));
  return base;
}

async function rmDirSafe(dir: string | undefined): Promise<void> {
  if (!dir) { return; }
  try {
    await fsp.rm(dir, { recursive: true, force: true });
  } catch {
    // ignore
  }
}

describe("uploads HTTP API (TS)", () => {
  const originalEnv = process.env;
  let uploadsDir: string | undefined;
  let ragDbDir: string | undefined;

  beforeEach(async () => {
    vi.resetModules();
    vi.clearAllMocks();
    process.env = { ...originalEnv };
    uploadsDir = await makeTempDir();
    process.env.UPLOADS_DIR = uploadsDir;
    delete process.env.UPLOAD_ALLOWED_EXTS;
    delete process.env.UPLOAD_MAX_BYTES;

    // Ensure the src/server RAG DB used by ingestion has an isolated path per test.
    ragDbDir = await fsp.mkdtemp(path.join(os.tmpdir(), "theapp-ragdb-"));
    process.env.RAG_DB_PATH = path.join(ragDbDir, "rag.sqlite");
    closeDb();
    initDb({ dbPath: process.env.RAG_DB_PATH });

    // Default behavior per spec: enabled in non-prod (test env). Tests may override.
    delete process.env.AUTO_INGEST_PDF_ON_UPLOAD;
  });

  afterEach(async () => {
    process.env = originalEnv;
    await rmDirSafe(uploadsDir);
    await rmDirSafe(ragDbDir);
    try {
      closeDb();
    } catch {
      // ignore
    }
    vi.unmock("../../rag/index.ts");
  });

  it("rejects disallowed types", async () => {
    const { createApp } = await import("../../app.ts");
    const app = createApp();

    const res = await request(app)
      .post("/api/uploads")
      .attach("file", Buffer.from("hello"), {
        filename: "evil.exe",
        contentType: "application/octet-stream",
      });

    expect(res.status).toBe(400);
    expect(res.body.ok).toBe(false);
    expect(String(res.body.error?.message || "")).toMatch(/not allowed/i);
  });

  it("rejects large files via UPLOAD_MAX_BYTES", async () => {
    process.env.UPLOAD_MAX_BYTES = "10";

    const { createApp } = await import("../../app.ts");
    const app = createApp();

    const res = await request(app)
      .post("/api/uploads")
      .attach("file", Buffer.alloc(50, "a"), {
        filename: "big.txt",
        contentType: "text/plain",
      });

    // Multer limit triggers 413; our handler maps LIMIT_FILE_SIZE to 413.
    expect([400, 413]).toContain(res.status);
    expect(res.body.ok).toBe(false);
  });

  it("saves manifest + file and lists entries", async () => {
    const { createApp } = await import("../../app.ts");
    const app = createApp();

    const uploadRes = await request(app)
      .post("/api/uploads")
      .attach("file", Buffer.from("hello world"), {
        filename: "note.txt",
        contentType: "text/plain",
      });

    expect(uploadRes.status).toBe(200);
    expect(uploadRes.body.ok).toBe(true);
    expect(uploadRes.body.upload?.id).toBeTruthy();
    expect(uploadRes.body.upload?.sha256).toMatch(/^[a-f0-9]{64}$/);
    expect(String(uploadRes.body.upload?.previewText || "")).toContain("hello");

    const manifestPath = path.join(uploadsDir || "", "manifest.json");
    const manifestRaw = await fsp.readFile(manifestPath, "utf8");
    const manifest = JSON.parse(manifestRaw) as { uploads?: Array<{ id: string }> };
    expect(Array.isArray(manifest.uploads)).toBe(true);
    expect(manifest.uploads?.[0]?.id).toBe(uploadRes.body.upload.id);

    const storedName = uploadRes.body.upload.storedName;
    await expect(fsp.stat(path.join(uploadsDir || "", storedName))).resolves.toBeTruthy();

    const listRes = await request(app).get("/api/uploads");
    expect(listRes.status).toBe(200);
    expect(listRes.body.ok).toBe(true);
    expect(listRes.body.uploads.length).toBeGreaterThan(0);
  });

  it("streams downloads", async () => {
    const { createApp } = await import("../../app.ts");
    const app = createApp();

    const uploadRes = await request(app)
      .post("/api/uploads")
      .attach("file", Buffer.from("download-me"), {
        filename: "d.txt",
        contentType: "text/plain",
      });

    const id = uploadRes.body.upload.id as string;
    const dl = await request(app).get(`/api/uploads/${encodeURIComponent(id)}/download`);
    expect(dl.status).toBe(200);
    expect(String((dl as any).text || (dl as any).body || "")).toContain("download-me");
  });

  it("deletes entry + file", async () => {
    const { createApp } = await import("../../app.ts");
    const app = createApp();

    const uploadRes = await request(app)
      .post("/api/uploads")
      .attach("file", Buffer.from("bye"), {
        filename: "bye.txt",
        contentType: "text/plain",
      });
    const id = uploadRes.body.upload.id as string;
    const storedName = uploadRes.body.upload.storedName as string;

    const del = await request(app).delete(`/api/uploads/${encodeURIComponent(id)}`);
    expect(del.status).toBe(200);
    expect(del.body.ok).toBe(true);

    await expect(fsp.stat(path.join(uploadsDir || "", storedName))).rejects.toBeTruthy();

    const listRes = await request(app).get("/api/uploads");
    expect(listRes.body.uploads.find((u: any) => u.id === id)).toBeFalsy();
  });

  it("uploads succeed even when RAG is not implemented (best-effort), and upsert is invoked for small txt", async () => {
    const upsertDocuments = vi.fn(async () => ({
      ok: false,
      upserted: 0,
      error: {
        kind: "not_implemented",
        message: "RAG is not implemented yet. Developers must wire embeddings/vector index.",
      },
    }));

    const deleteDocuments = vi.fn(async () => ({
      ok: false,
      deleted: 0,
      error: {
        kind: "not_implemented",
        message: "RAG is not implemented yet. Developers must wire embeddings/vector index.",
      },
    }));

    const query = vi.fn(async (q: string) => ({
      ok: false,
      query: q,
      results: [],
      error: {
        kind: "not_implemented",
        message: "RAG search is not implemented yet. Developers must wire embeddings/vector index.",
      },
    }));

    vi.doMock("../../rag/index.ts", async () => {
      const actual = await vi.importActual<typeof import("../../rag/index.ts")>("../../rag/index.ts");
      return {
        ...actual,
        createRagService: vi.fn(() => ({ upsertDocuments, deleteDocuments, query })),
      };
    });

    vi.resetModules();
    const { createApp } = await import("../../app.ts");
    const app = createApp();

    const uploadRes = await request(app)
      .post("/api/uploads")
      .attach("file", Buffer.from("hello rag"), {
        filename: "rag.txt",
        contentType: "text/plain",
      });

    expect(uploadRes.status).toBe(200);
    expect(uploadRes.body.ok).toBe(true);
    const uploadId = String(uploadRes.body.upload?.id || "");
    expect(uploadId).toBeTruthy();
    const createdAt = String(uploadRes.body.upload?.createdAt || "");
    expect(createdAt).toMatch(/\d{4}-\d{2}-\d{2}T/);

    // best-effort work is async; allow it to run
    await new Promise((r) => setTimeout(r, 0));

    // best-effort: should have attempted upsert
    expect(upsertDocuments).toHaveBeenCalledTimes(1);
    const calls = upsertDocuments.mock.calls as unknown as unknown[][];
    const firstCall = calls[0];
    expect(firstCall).toBeTruthy();
    const docsArgUnknown = (firstCall as unknown[])[0];
    expect(Array.isArray(docsArgUnknown)).toBe(true);
    const docsArg = docsArgUnknown as Array<Record<string, unknown>>;
    expect(docsArg[0]?.id).toBe(uploadId);
    expect(docsArg[0]?.source).toBe("upload");
    expect(docsArg[0]?.sourceId).toBe(uploadId);
    expect(docsArg[0]?.title).toBe("rag.txt");
    expect(docsArg[0]?.mimeType).toBe("text/plain");
    expect(String(docsArg[0]?.createdAt || "")).toBe(createdAt);
    expect(String(docsArg[0]?.text || "")).toContain("hello rag");
    expect(docsArg[0]?.meta && typeof docsArg[0]?.meta === "object").toBe(true);

    const delRes = await request(app).delete(`/api/uploads/${encodeURIComponent(uploadId)}`);
    expect(delRes.status).toBe(200);
    expect(delRes.body.ok).toBe(true);

    await new Promise((r) => setTimeout(r, 0));
    expect(deleteDocuments).toHaveBeenCalledTimes(1);
    expect(deleteDocuments).toHaveBeenCalledWith([uploadId]);
  });

  it("uploads succeed even when rag.upsertDocuments throws (best-effort)", async () => {
    const upsertDocuments = vi.fn(async () => {
      throw new Error("boom");
    });

    const deleteDocuments = vi.fn(async () => ({ ok: true, deleted: 1 }));
    const query = vi.fn(async (q: string) => ({ ok: true, query: q, results: [] }));

    vi.doMock("../../rag/index.ts", async () => {
      const actual = await vi.importActual<typeof import("../../rag/index.ts")>("../../rag/index.ts");
      return {
        ...actual,
        createRagService: vi.fn(() => ({ upsertDocuments, deleteDocuments, query })),
      };
    });

    vi.resetModules();
    const { createApp } = await import("../../app.ts");
    const app = createApp();

    const uploadRes = await request(app)
      .post("/api/uploads")
      .attach("file", Buffer.from("hello rag"), {
        filename: "rag.txt",
        contentType: "text/plain",
      });

    expect(uploadRes.status).toBe(200);
    expect(uploadRes.body.ok).toBe(true);

    await new Promise((r) => setTimeout(r, 0));
    expect(upsertDocuments).toHaveBeenCalledTimes(1);
  });

  it("deletes succeed even when rag.deleteDocuments throws (best-effort)", async () => {
    const upsertDocuments = vi.fn(async () => ({ ok: true, upserted: 1 }));
    const deleteDocuments = vi.fn(async () => {
      throw new Error("boom");
    });
    const query = vi.fn(async (q: string) => ({ ok: true, query: q, results: [] }));

    vi.doMock("../../rag/index.ts", async () => {
      const actual = await vi.importActual<typeof import("../../rag/index.ts")>("../../rag/index.ts");
      return {
        ...actual,
        createRagService: vi.fn(() => ({ upsertDocuments, deleteDocuments, query })),
      };
    });

    vi.resetModules();
    const { createApp } = await import("../../app.ts");
    const app = createApp();

    const uploadRes = await request(app)
      .post("/api/uploads")
      .attach("file", Buffer.from("bye"), {
        filename: "bye.txt",
        contentType: "text/plain",
      });

    expect(uploadRes.status).toBe(200);
    const id = String(uploadRes.body.upload.id);

    const del = await request(app).delete(`/api/uploads/${encodeURIComponent(id)}`);
    expect(del.status).toBe(200);
    expect(del.body.ok).toBe(true);

    await new Promise((r) => setTimeout(r, 0));
    expect(deleteDocuments).toHaveBeenCalledTimes(1);
    expect(deleteDocuments).toHaveBeenCalledWith([id]);
  });

  it("auto-enqueues PDF ingest on upload when enabled, and indexes asynchronously", async () => {
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
    expect(String(uploadRes.body.upload?.id || "")).toBeTruthy();

    expect(uploadRes.body.rag?.status).toBe("queued");
    const jobId = String(uploadRes.body.rag?.jobId || "");
    expect(jobId).toBeTruthy();

    const status = await waitForJobDone(app, jobId, 12_000);
    expect(String(status.state)).toBe("done");
    expect(Number(status.result?.chunksInserted || 0)).toBeGreaterThan(0);

    const uploadId = String(uploadRes.body.upload?.id || "");
    const db = getDb();
    const docRow = db.prepare("SELECT status FROM documents WHERE id = ?").get(uploadId) as any;
    expect(String(docRow?.status || "")).toBe("indexed");

    const chunkRow = db
      .prepare("SELECT content FROM chunks WHERE documentId = ? ORDER BY chunkIndex LIMIT 50")
      .all(uploadId) as any[];
    expect(chunkRow.length).toBeGreaterThan(0);
    expect(chunkRow.some((r) => String(r?.content || "").includes("Hello PDF"))).toBe(true);
  });

  it("does not auto-queue PDFs when AUTO_INGEST_PDF_ON_UPLOAD=false", async () => {
    process.env.AUTO_INGEST_PDF_ON_UPLOAD = "false";
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
    expect(uploadRes.body.rag?.status).toBe("not_queued");
  });
});
