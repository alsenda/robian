import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import request from "supertest";
import { PDFDocument, StandardFonts } from "pdf-lib";

import { EMBEDDING_DIM } from "../../../src/server/db/constants.ts";
import { closeDb, getDb, initDb } from "../../../src/server/db/index.ts";
import { wipeRagDb } from "../../../src/server/db/wipeRagDb.ts";

import { createRagSearchUploadsTool } from "../../uploads/tools/ragSearchUploads.tool.ts";
import { createRagService } from "../../rag/index.ts";

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

async function waitForJobDone(app: any, jobId: string, timeoutMs = 10_000): Promise<any> {
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

describe("PDF upload becomes searchable via rag_search_uploads", () => {
  beforeAll(() => {
    process.env.RAG_PROVIDER = "sqlite";
    initDb();
  });

  beforeEach(() => {
    wipeRagDb(getDb());
  });

  afterAll(() => {
    closeDb();
  });

  it("indexes uploaded PDF into same DB queried by rag_search_uploads", async () => {
    const unique = `Unique PDF text ${Date.now()}`;
    const pdfBuffer = await makeOnePagePdf(unique);

    const { createApp } = await import("../../app.ts");
    const app = createApp();

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

    const ingestRes = await request(app)
      .post(`/api/rag/ingest/${encodeURIComponent(uploadId)}`)
      .send({ userId: "local" });
    expect(ingestRes.status).toBe(200);
    const jobId = String(ingestRes.body.jobId || "");
    expect(jobId).toBeTruthy();

    const status = await waitForJobDone(app, jobId, 15_000);
    expect(String(status.state)).toBe("done");

    const rag = createRagService({ provider: "sqlite" });
    const tool = createRagSearchUploadsTool({ rag });

    const out = await tool.execute({ query: unique, topK: 5 });
    expect(out.ok).toBe(true);
    expect(out.results.length).toBeGreaterThan(0);
    expect(out.results.some((r) => String(r.filename || "") === "doc.pdf")).toBe(true);
  });
});
