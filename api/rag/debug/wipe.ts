import express from "express";

import { getDb, initDb } from "../../../src/server/db/index.ts";
import { wipeRagDb } from "../../../src/server/db/wipeRagDb.ts";

function allowWipe(): boolean {
  const raw = String(process.env.RAG_ALLOW_WIPE || "").trim().toLowerCase();
  return raw === "1" || raw === "true" || raw === "yes";
}

export function createRagDebugRouter(): express.Router {
  const router = express.Router();

  // POST /api/rag/debug/wipe
  router.post("/wipe", (_req, res) => {
    if (!allowWipe()) {
      return res.status(404).json({ ok: false, error: { message: "Not found" } });
    }

    try {
      initDb();
      const db = getDb();
      const counts = wipeRagDb(db);
      return res.status(200).json({ ok: true, counts });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error ?? "unknown error");
      return res.status(500).json({ ok: false, error: { message } });
    }
  });

  return router;
}
