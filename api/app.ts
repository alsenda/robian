import express from "express";
import cors from "cors";

import { createHandleChat } from "./chat/index.ts";
import { createUploadsRouter } from "./uploads/index.ts";
import { createRagService } from "./rag/index.ts";
import { createRagHealthHandler } from "./rag/health.ts";
import { createRagIngestRouter } from "./rag/ingest.ts";
import { createRagAskRouter } from "./rag/ask.ts";

export function createApp(): express.Express {
  const app = express();

  app.use(cors());
  app.use(express.json());

  const ragService = createRagService();

  // RAG health/status endpoint (read-only)
  app.get("/api/rag/health", createRagHealthHandler());

  // RAG ingestion (async)
  app.use("/api/rag/ingest", createRagIngestRouter());

  // RAG ask (retrieval + grounded answer)
  app.use("/api/rag/ask", createRagAskRouter());

  // Chat endpoint (existing behavior)
  app.post("/api/chat", createHandleChat({ ragService }));

  // Uploads feature
  app.use("/api/uploads", createUploadsRouter({ rag: ragService }));

  return app;
}
