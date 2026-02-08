import os from "node:os";
import path from "node:path";
import fs from "node:fs";
import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, vi } from "vitest";

import { closeDb } from "../../src/server/db/index.ts";

let tempDir: string | null = null;
let uploadsDir: string | null = null;
let dbPath: string | null = null;

function ensureDir(p: string): void {
  fs.mkdirSync(p, { recursive: true });
}

function rmSafe(p: string | null): void {
  if (!p) { return; }
  try {
    fs.rmSync(p, { recursive: true, force: true });
  } catch {
    // ignore
  }
}

beforeAll(() => {
  // Ensure per-worker isolation. (Vitest may run tests in multiple workers.)
  const root = path.join(os.tmpdir(), `robian-vitest-${process.pid}-${randomUUID()}`);
  tempDir = root;
  uploadsDir = path.join(root, "uploads");
  dbPath = path.join(root, "rag.sqlite");

  ensureDir(root);
  ensureDir(uploadsDir);

  process.env.NODE_ENV = "test";
  process.env.VITEST = "1";

  // Canonical DB path for ALL tests.
  process.env.RAG_DB_PATH = dbPath;

  // Canonical uploads directory for HTTP upload tests.
  process.env.UPLOADS_DIR = uploadsDir;

  // Helps avoid persistent fixtures leaking into dev.
  delete process.env.RAG_PROVIDER;

  // Reset module cache between test files that mutate env.
  vi.resetModules();
});

afterAll(() => {
  try {
    closeDb();
  } catch {
    // ignore
  }

  rmSafe(tempDir);
  tempDir = null;
  uploadsDir = null;
  dbPath = null;
});
