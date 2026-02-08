import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import request from "supertest";

describe("RAG ask HTTP API (TS)", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
    vi.unmock("../../../src/server/rag/embeddings/ollama.ts");
    vi.unmock("../../../src/server/rag/vectorStore.ts");
    vi.unmock("../../../src/server/rag/llm/ollamaChat.ts");
  });

  it("returns answer + sources and uses topK default", async () => {
    const embedQueryMock = vi.fn(async (..._args: any[]) => [0, 1, 2]);
    const vectorSearchMock = vi.fn((..._args: any[]) => [
      {
        chunkId: "c1",
        documentId: "d1",
        filename: "doc.pdf",
        pageStart: 1,
        pageEnd: 2,
        content: "hello",
        score: 0.99,
      },
    ]);
    const chatMock = vi.fn(async (..._args: any[]) => "final answer");

    vi.doMock("../../../src/server/rag/embeddings/ollama.ts", () => ({
      embedQuery: embedQueryMock,
    }));

    vi.doMock("../../../src/server/rag/vectorStore.ts", () => ({
      vectorSearch: vectorSearchMock,
    }));

    vi.doMock("../../../src/server/rag/llm/ollamaChat.ts", () => ({
      chat: chatMock,
    }));

    const { createApp } = await import("../../app.ts");
    const app = createApp();

    const res = await request(app)
      .post("/api/rag/ask")
      .send({ userId: "u1", question: "What is in the doc?" });

    expect(res.status).toBe(200);
    expect(res.body.answer).toBe("final answer");
    expect(Array.isArray(res.body.sources)).toBe(true);
    expect(res.body.sources).toEqual([
      {
        filename: "doc.pdf",
        documentId: "d1",
        chunkId: "c1",
        pageStart: 1,
        pageEnd: 2,
        score: 0.99,
      },
    ]);

    expect(embedQueryMock).toHaveBeenCalledTimes(1);
    expect(embedQueryMock).toHaveBeenCalledWith("What is in the doc?");

    expect(vectorSearchMock).toHaveBeenCalledTimes(1);
    expect((vectorSearchMock.mock.calls[0] as any)?.[1]).toEqual({ userId: "u1", topK: 8 });

    expect(chatMock).toHaveBeenCalledTimes(1);
    expect(String((chatMock.mock.calls[0] as any)?.[0] || "")).toContain("Context:");
  });
});
