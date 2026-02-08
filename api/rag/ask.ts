import express from "express";

import { embedQuery } from "../../src/server/rag/embeddings/ollama.ts";
import { vectorSearch } from "../../src/server/rag/vectorStore.ts";
import { buildRagPrompt } from "../../src/server/rag/prompt/buildPrompt.ts";
import { chat } from "../../src/server/rag/llm/ollamaChat.ts";

interface AskBody {
  userId: string;
  question: string;
  topK?: number;
  documentIds?: string[];
}

function parseTopK(value: unknown, fallback: number): number {
  const n = typeof value === "number" ? value : value != null ? Number(value) : NaN;
  if (!Number.isFinite(n) || n <= 0) { return fallback; }
  return Math.floor(n);
}

export function createRagAskRouter(): express.Router {
  const router = express.Router();

  // POST /api/rag/ask
  router.post("/", async (req, res) => {
    const body = (req.body || {}) as Partial<AskBody>;

    const userId = String(body.userId || "local").trim() || "local";
    const question = String(body.question || "").trim();
    if (!question) {
      return res.status(400).json({ ok: false, error: { message: "Question is required" } });
    }

    const topK = parseTopK(body.topK, 8);
    const documentIds = Array.isArray(body.documentIds)
      ? body.documentIds.map((d) => String(d || "").trim()).filter(Boolean)
      : undefined;

    try {
      const queryVector = await embedQuery(question);

      const searchOpts: { userId: string; topK: number; docIds?: string[] } = { userId, topK };
      if (documentIds && documentIds.length) { searchOpts.docIds = documentIds; }

      const chunks = vectorSearch(queryVector, searchOpts);

      const prompt = buildRagPrompt({ question, chunks });
      const answer = await chat(prompt);

      return res.status(200).json({
        answer,
        sources: chunks.map((c) => ({
          filename: c.filename,
          documentId: c.documentId,
          chunkId: c.chunkId,
          pageStart: c.pageStart,
          pageEnd: c.pageEnd,
          score: c.score,
        })),
      });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error ?? "unknown error");
      return res.status(500).json({ ok: false, error: { message } });
    }
  });

  return router;
}
