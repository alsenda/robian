import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { EventEmitter } from "node:events";

let capturedSse = "";
let consumeDone: Promise<void> = Promise.resolve();
let pipeSpy: ReturnType<typeof vi.fn>;

function createSseStream(dataEvents: string[]) {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      for (const event of dataEvents) {
        controller.enqueue(encoder.encode(`data: ${event}\n\n`));
      }
      controller.enqueue(encoder.encode("data: [DONE]\n\n"));
      controller.close();
    },
  });
}

function parseCapturedChunks(): any[] {
  const chunks: any[] = [];
  const lines = String(capturedSse || "").split("\n");
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("data:")) { continue; }
    const payload = trimmed.slice("data:".length).trim();
    if (!payload || payload === "[DONE]") { continue; }
    try {
      chunks.push(JSON.parse(payload));
    } catch {
      // ignore
    }
  }
  return chunks;
}

vi.mock("@tanstack/ai", async (importOriginal) => {
  const actual = await importOriginal<any>();
  return {
    ...actual,
    convertMessagesToModelMessages: vi.fn((messages: unknown) => messages),
    toServerSentEventsStream: (stream: any) => {
      const encoder = new TextEncoder();
      return new ReadableStream({
        async start(controller) {
          for await (const chunk of stream) {
            controller.enqueue(encoder.encode(`data: ${JSON.stringify(chunk)}\n\n`));
          }
          controller.close();
        },
      });
    },
  };
});

vi.mock("node:stream", () => {
  pipeSpy = vi.fn();
  return {
    Readable: {
      fromWeb: vi.fn((webStream: any) => {
        capturedSse = "";
        consumeDone = (async () => {
          if (!webStream || typeof webStream.getReader !== "function") { return; }
          const reader = webStream.getReader();
          const decoder = new TextDecoder();
          try {
            while (true) {
              const { done, value } = await reader.read();
              if (done) { break; }
              capturedSse += decoder.decode(value, { stream: true });
            }
          } finally {
            try {
              reader.releaseLock();
            } catch {
              // ignore
            }
          }
        })();

        const nodeStream = {
          pipe: pipeSpy,
          on: vi.fn(() => nodeStream),
          destroy: vi.fn(),
        };
        return nodeStream;
      }),
    },
  };
});

const { createHandleChat } = await import("../../chat/index.ts");

function createReqRes({ body }: { body?: unknown } = {}) {
  const req = new EventEmitter() as any;
  req.body = body;

  const headers = new Map<string, unknown>();
  const res = new EventEmitter() as any;
  Object.assign(res, {
    statusCode: undefined as number | undefined,
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    setHeader(key: string, value: unknown) {
      headers.set(key, value);
    },
    flushHeaders: vi.fn(),
    write: vi.fn(),
    end: vi.fn(),
    jsonPayload: undefined as unknown,
    json(payload: unknown) {
      this.jsonPayload = payload;
      return this;
    },
  });

  return { req, res, headers };
}

describe("handleChat autonomous RAG (behavioral)", () => {
  const uploadId = "00000000-0000-4000-8000-000000000001";
  const originalEnv = process.env;
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    process.env = { ...originalEnv };
    delete process.env.RAG_AUTONUDGE;
  });

  afterEach(() => {
    process.env = originalEnv;
    globalThis.fetch = originalFetch;
  });

  it("doc-related query triggers rag_search_uploads tool-call before answering", async () => {
    process.env.RAG_DOC_TOPK = "5";

    const rag = {
      upsertDocuments: async () => ({ ok: true, upserted: 0 }),
      deleteDocuments: async () => ({ ok: true, deleted: 0 }),
      query: vi.fn(async () => ({
        ok: true,
        query: "payment terms",
        results: [
          {
            id: "u1:0",
            chunkId: "u1:0",
            documentId: uploadId,
            filename: "contract.txt",
            pageStart: 1,
            pageEnd: 1,
            score: 0.9,
            source: "upload",
            sourceId: uploadId,
            excerpt: "Net 30.",
          },
        ],
      })),
    };

    const handleChat = createHandleChat({ ragService: rag as any });

    globalThis.fetch = vi.fn(async (url: any) => {
      const u = String(url || "");
      if (!u.endsWith("/api/generate")) {
        throw new Error(`Unexpected fetch url in doc-RAG path: ${u}`);
      }

      return {
        ok: true,
        status: 200,
        statusText: "OK",
        json: async () => ({
          response: "The payment terms are Net 30. [source: contract.txt p.1-1 chunk:u1:0]",
        }),
      } as any;
    }) as any;

    const { req, res } = createReqRes({
      body: { messages: [{ role: "user", content: `In upload ${uploadId}, what are the payment terms?` }] },
    });

    await handleChat(req, res);
    await consumeDone;

    expect(res.statusCode).toBe(200);
    expect(pipeSpy).toHaveBeenCalledTimes(1);

    expect(rag.query).toHaveBeenCalledTimes(1);
    expect(rag.query).toHaveBeenCalledWith(
      `In upload ${uploadId}, what are the payment terms?`,
      5,
      { source: "upload", sourceId: uploadId },
    );

    const events = parseCapturedChunks();
    const firstToolCallIndex = events.findIndex((e) => e?.type === "tool_call");
    const firstContentIndex = events.findIndex((e) => e?.type === "content");
    expect(firstToolCallIndex).toBeGreaterThanOrEqual(0);
    expect(firstContentIndex).toBeGreaterThanOrEqual(0);
    expect(firstToolCallIndex).toBeLessThan(firstContentIndex);

    expect(capturedSse).toMatch(/\[source:/i);
  });

  it("general knowledge query does not call rag_search_uploads", async () => {
    const rag = {
      upsertDocuments: async () => ({ ok: true, upserted: 0 }),
      deleteDocuments: async () => ({ ok: true, deleted: 0 }),
      query: vi.fn(async () => ({ ok: true, query: "q", results: [] })),
    };

    const handleChat = createHandleChat({ ragService: rag as any });

    globalThis.fetch = vi.fn(async () => {
      return {
        ok: true,
        status: 200,
        statusText: "OK",
        body: createSseStream([
          JSON.stringify({
            model: "robian:latest",
            choices: [
              {
                delta: { content: "Paris." },
                finish_reason: "stop",
              },
            ],
          }),
        ]),
      } as any;
    }) as any;

    const { req, res } = createReqRes({
      body: { messages: [{ role: "user", content: "What is the capital of France?" }] },
    });

    await handleChat(req, res);
    await consumeDone;

    expect(res.statusCode).toBe(200);
    expect(rag.query).toHaveBeenCalledTimes(0);
    expect(capturedSse).toContain("Paris");
  });
});

describe("handleChat doc-RAG strictness (server enforced)", () => {
  const uploadId = "00000000-0000-4000-8000-000000000001";
  const originalEnv = process.env;
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    process.env = { ...originalEnv, RAG_DOC_TOPK: "5" };
  });

  afterEach(() => {
    process.env = originalEnv;
    globalThis.fetch = originalFetch;
  });

  it("weak results trigger exactly one rewritten retrieval (2 searches max)", async () => {
    const rag = {
      upsertDocuments: async () => ({ ok: true, upserted: 0 }),
      deleteDocuments: async () => ({ ok: true, deleted: 0 }),
      query: vi
        .fn()
        .mockResolvedValueOnce({
          ok: true,
          query: "q1",
          weak: true,
          results: [
            {
              id: "u1:0",
              chunkId: "u1:0",
              documentId: uploadId,
              filename: "contract.txt",
              pageStart: 1,
              pageEnd: 1,
              score: 0.9,
              source: "upload",
              sourceId: uploadId,
              excerpt: "Net 30.",
              matchCount: 0,
            },
          ],
        })
        .mockResolvedValueOnce({
          ok: true,
          query: "q2",
          weak: false,
          results: [
            {
              id: "u1:0",
              chunkId: "u1:0",
              documentId: uploadId,
              filename: "contract.txt",
              pageStart: 1,
              pageEnd: 1,
              score: 0.9,
              source: "upload",
              sourceId: uploadId,
              excerpt: "Net 30.",
              matchCount: 2,
            },
          ],
        }),
    };

    const handleChat = createHandleChat({ ragService: rag as any });

    globalThis.fetch = vi.fn(async () => {
      return {
        ok: true,
        status: 200,
        statusText: "OK",
        json: async () => ({
          response: "The payment terms are Net 30. [source: contract.txt p.1-1 chunk:u1:0]",
        }),
      } as any;
    }) as any;

    const { req, res } = createReqRes({
      body: {
        messages: [
          {
            role: "user",
            content: `In upload ${uploadId}, please tell me what are the payment terms in the contract document`,
          },
        ],
      },
    });

    await handleChat(req, res);
    await consumeDone;

    expect(res.statusCode).toBe(200);
    expect(rag.query).toHaveBeenCalledTimes(2);
    const firstQuery = (rag.query as any).mock.calls[0][0];
    const secondQuery = (rag.query as any).mock.calls[1][0];
    expect(String(firstQuery)).not.toEqual(String(secondQuery));
  });

  it("rejects fabricated chunk ids by retrying generation once", async () => {
    const rag = {
      upsertDocuments: async () => ({ ok: true, upserted: 0 }),
      deleteDocuments: async () => ({ ok: true, deleted: 0 }),
      query: vi.fn(async () => ({
        ok: true,
        query: "q",
        weak: false,
        results: [
          {
            id: "u1:0",
            chunkId: "u1:0",
            documentId: uploadId,
            filename: "contract.txt",
            pageStart: 1,
            pageEnd: 1,
            score: 0.9,
            source: "upload",
            sourceId: uploadId,
            excerpt: "Net 30.",
            matchCount: 2,
          },
        ],
      })),
    };

    const handleChat = createHandleChat({ ragService: rag as any });

    let genCall = 0;
    globalThis.fetch = vi.fn(async (url: any) => {
      const u = String(url || "");
      if (!u.endsWith("/api/generate")) {
        throw new Error(`Unexpected fetch url: ${u}`);
      }

      genCall++;
      if (genCall === 1) {
        return {
          ok: true,
          status: 200,
          statusText: "OK",
          json: async () => ({
            response: "The payment terms are Net 30. [source: contract.txt p.1-1 chunk:FAKE]",
          }),
        } as any;
      }

      return {
        ok: true,
        status: 200,
        statusText: "OK",
        json: async () => ({
          response: "The payment terms are Net 30. [source: contract.txt p.1-1 chunk:u1:0]",
        }),
      } as any;
    }) as any;

    const { req, res } = createReqRes({
      body: { messages: [{ role: "user", content: `In upload ${uploadId}, what are the payment terms?` }] },
    });

    await handleChat(req, res);
    await consumeDone;

    expect(res.statusCode).toBe(200);
    expect(genCall).toBe(2);

    const events = parseCapturedChunks();
    const lastContent = [...events].reverse().find((e) => e?.type === "content")?.content;
    expect(String(lastContent || "")).toContain("chunk:u1:0");
    expect(String(lastContent || "")).not.toContain("chunk:FAKE");
  });
});
