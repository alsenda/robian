import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import os from "node:os";
import path from "node:path";
import fsp from "node:fs/promises";

import { createStubRagService } from "../../rag/ragService.stub.ts";
import { createRagSearchUploadsTool } from "../../uploads/tools/ragSearchUploads.tool.ts";
import type { RagQueryResult } from "../../rag/types.ts";

async function makeTempDir(): Promise<string> {
  const base = await fsp.mkdtemp(path.join(os.tmpdir(), "theapp-uploads-tools-"));
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

describe("uploads tools (TS)", () => {
  const originalEnv = process.env;
  let uploadsDir: string | undefined;

  beforeEach(async () => {
    vi.resetModules();
    process.env = { ...originalEnv };
    uploadsDir = await makeTempDir();
    process.env.UPLOADS_DIR = uploadsDir;
  });

  afterEach(async () => {
    process.env = originalEnv;
    await rmDirSafe(uploadsDir);
  });

  it("list_uploads returns entries", async () => {
    const { addManifestEntry } = await import("../../uploads/db/manifest.ts");
    const { listUploadsTool } = await import("../../chat/tools/index.ts");

    await addManifestEntry({
      id: "u1",
      originalName: "a.txt",
      storedName: "u1.txt",
      mimeType: "text/plain",
      sizeBytes: 1,
      createdAt: new Date().toISOString(),
      sha256: "0".repeat(64),
      extension: "txt",
      extractable: true,
      previewText: "x",
    });

    const out = (await listUploadsTool.execute({ limit: 10 })) as any;
    expect(out.uploads.length).toBe(1);
    expect(out.uploads[0].id).toBe("u1");
  });

  it("get_upload returns previewText for txt", async () => {
    const { addManifestEntry } = await import("../../uploads/db/manifest.ts");
    const { getUploadTool } = await import("../../chat/tools/index.ts");

    await addManifestEntry({
      id: "u2",
      originalName: "note.txt",
      storedName: "u2.txt",
      mimeType: "text/plain",
      sizeBytes: 5,
      createdAt: new Date().toISOString(),
      sha256: "1".repeat(64),
      extension: "txt",
      extractable: true,
      previewText: "hello world",
    });

    const out = (await getUploadTool.execute({ id: "u2", maxChars: 5 })) as any;
    expect(out.ok).toBe(true);
    expect(out.previewText).toBe("hello");
  });

  it("rag_search_uploads returns not_implemented error with empty results", async () => {
    const rag = createStubRagService();
    const tool = createRagSearchUploadsTool({ rag });
    const out: RagQueryResult = await tool.execute({ query: "anything", topK: 3 });
    expect(out.ok).toBe(false);
    expect(out.results).toEqual([]);
    expect(out.error?.kind).toBe("not_implemented");
    expect(String(out.error?.message || "")).toMatch(/RAG_PROVIDER=sqlite/i);
  });

  it("rag_search_uploads calls rag.query with upload filters and returns output", async () => {
    const sourceId = "00000000-0000-4000-8000-000000000001";
    const rag = {
      upsertDocuments: async () => ({ ok: true, upserted: 0 }),
      deleteDocuments: async () => ({ ok: true, deleted: 0 }),
      query: vi.fn(async () => ({
        ok: true,
        query: "q",
        results: [
          {
            id: "doc:0",
            score: 0.9,
            source: "upload",
            sourceId,
            title: "t",
            excerpt: "e",
          },
        ],
      })),
    };

    const tool = createRagSearchUploadsTool({ rag: rag as any });
    const out = (await tool.execute({ query: "q", topK: 5, sourceId })) as RagQueryResult;
    expect(out.ok).toBe(true);
    expect(out.results.length).toBe(1);
    expect(rag.query).toHaveBeenCalledTimes(1);
    expect(rag.query).toHaveBeenCalledWith("q", 5, { source: "upload", sourceId });
  });

  it("rag_search_uploads coerces topK numeric strings", async () => {
    const rag = {
      upsertDocuments: async () => ({ ok: true, upserted: 0 }),
      deleteDocuments: async () => ({ ok: true, deleted: 0 }),
      query: vi.fn(async () => ({ ok: true, query: "q", results: [] })),
    };

    const tool = createRagSearchUploadsTool({ rag: rag as any });
    const out = (await tool.execute({ query: " q ", topK: "1" })) as RagQueryResult;
    expect(out.ok).toBe(true);
    expect(rag.query).toHaveBeenCalledWith("q", 1, { source: "upload" });
  });

  it("rag_search_uploads accepts topK as numeric string \"50\"", async () => {
    const rag = {
      upsertDocuments: async () => ({ ok: true, upserted: 0 }),
      deleteDocuments: async () => ({ ok: true, deleted: 0 }),
      query: vi.fn(async () => ({ ok: true, query: "q", results: [] })),
    };

    const tool = createRagSearchUploadsTool({ rag: rag as any });
    const out = (await tool.execute({ query: "q", topK: "50" })) as RagQueryResult;
    expect(out.ok).toBe(true);
    expect(rag.query).toHaveBeenCalledWith("q", 50, { source: "upload" });
  });

  it("rag_search_uploads rejects empty query with details", async () => {
    const rag = {
      upsertDocuments: async () => ({ ok: true, upserted: 0 }),
      deleteDocuments: async () => ({ ok: true, deleted: 0 }),
      query: vi.fn(async () => ({ ok: true, query: "q", results: [] })),
    };

    const tool = createRagSearchUploadsTool({ rag: rag as any });
    const out = (await tool.execute({ query: "   ", topK: "1" })) as RagQueryResult;
    expect(out.ok).toBe(false);
    expect(out.error?.kind).toBe("invalid_input");
    expect(String(out.error?.message || "")).toMatch(/non-empty/i);
    expect(Array.isArray((out.error as any)?.details)).toBe(true);
    expect(((out.error as any).details as any[]).some((d) => d.field === "query")).toBe(true);
  });

  it("rag_search_uploads treats sourceId null as undefined", async () => {
    const rag = {
      upsertDocuments: async () => ({ ok: true, upserted: 0 }),
      deleteDocuments: async () => ({ ok: true, deleted: 0 }),
      query: vi.fn(async () => ({ ok: true, query: "q", results: [] })),
    };

    const tool = createRagSearchUploadsTool({ rag: rag as any });
    const out = (await tool.execute({ query: "q", sourceId: null })) as RagQueryResult;
    expect(out.ok).toBe(true);
    expect(rag.query).toHaveBeenCalledWith("q", 8, { source: "upload" });
  });

  it("rag_search_uploads treats sourceId string \"null\" as undefined", async () => {
    const rag = {
      upsertDocuments: async () => ({ ok: true, upserted: 0 }),
      deleteDocuments: async () => ({ ok: true, deleted: 0 }),
      query: vi.fn(async () => ({ ok: true, query: "q", results: [] })),
    };

    const tool = createRagSearchUploadsTool({ rag: rag as any });
    const out = (await tool.execute({ query: "q", sourceId: "null" })) as RagQueryResult;
    expect(out.ok).toBe(true);
    expect(rag.query).toHaveBeenCalledWith("q", 8, { source: "upload" });
  });

  it("rag_search_uploads rejects non-UUID sourceId strings", async () => {
    const rag = {
      upsertDocuments: async () => ({ ok: true, upserted: 0 }),
      deleteDocuments: async () => ({ ok: true, deleted: 0 }),
      query: vi.fn(async () => ({ ok: true, query: "q", results: [] })),
    };

    const tool = createRagSearchUploadsTool({ rag: rag as any });
    const out = (await tool.execute({ query: "q", sourceId: "abc" })) as RagQueryResult;
    expect(out.ok).toBe(false);
    expect(out.error?.kind).toBe("invalid_input");
    expect(String(out.error?.message || "")).toMatch(/UUID/i);
    expect(rag.query).not.toHaveBeenCalled();
  });

  it("rag_search_uploads returns ok:false when rag.query throws", async () => {
    const rag = {
      upsertDocuments: async () => ({ ok: true, upserted: 0 }),
      deleteDocuments: async () => ({ ok: true, deleted: 0 }),
      query: vi.fn(async () => {
        throw new Error("no db");
      }),
    };

    const tool = createRagSearchUploadsTool({ rag: rag as any });
    const out = (await tool.execute({ query: "q" })) as RagQueryResult;
    expect(out.ok).toBe(false);
    expect(out.query).toBe("q");
    expect(out.results).toEqual([]);
    expect(out.error?.kind).toBe("rag_unavailable");
    expect(String(out.error?.message || "")).toMatch(/no db|unavailable/i);
  });
});
