import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

import type { Database } from "./types.ts";
import { runMigrations } from "./migrate.ts";

let _db: Database | null = null;
let _initialized = false;

function resolveDbPath(dbPath: string): string {
  const p = String(dbPath || "").trim() || "data/rag.sqlite";
  return path.isAbsolute(p) ? p : path.resolve(process.cwd(), p);
}

function ensureParentDir(filePath: string): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
}

function loadBetterSqlite3Ctor(): unknown {
  const require = createRequire(import .meta.url);
  return require("better-sqlite3") as unknown;
}

function openDb(dbPath: string): Database {
  const filePath = resolveDbPath(dbPath);
  ensureParentDir(filePath);

  const mod = loadBetterSqlite3Ctor();
  const DatabaseCtor =
    (typeof mod === "function" ? mod : (mod as { default?: unknown }).default) as unknown;

  if (typeof DatabaseCtor !== "function") {
    throw new Error("Failed to load better-sqlite3");
  }

  const db = new (DatabaseCtor as new (p: string) => Database)(filePath);
  return db;
}

function tryLoadSqliteVecExtension(db: Database): void {
  const require = createRequire(import .meta.url);
  const mod = require("sqlite-vec") as unknown;
  const anyMod = mod as any;

  const loadFn: unknown =
    (typeof anyMod?.load === "function" && anyMod.load) ||
    (typeof anyMod?.default?.load === "function" && anyMod.default.load) ||
    (typeof anyMod === "function" && anyMod);

  if (typeof loadFn === "function") {
    (loadFn as (db: unknown) => void)(db);
     return;
  }

  const loadablePath: unknown =
    (typeof anyMod?.loadablePath === "function" && anyMod.loadablePath) ||
    (typeof anyMod?.default?.loadablePath === "function" && anyMod.default.loadablePath);

  if (typeof loadablePath === "function") {
    const p = String((loadablePath as () => unknown)());
    db.loadExtension(p);
    return;
  }

  throw new Error("sqlite-vec module did not expose a usable loader");
}

export function initDb(opts?: { dbPath?: string }): void {
  if (_initialized) { return; }

  const dbPath = opts?.dbPath ?? process.env.RAG_DB_PATH ?? "data/rag.sqlite";
  const db = _db ?? openDb(dbPath);
  _db = db;

  db.pragma("foreign_keys = ON");

  // Required for vec0 virtual tables.
  tryLoadSqliteVecExtension(db);

  runMigrations(db);
  _initialized = true;
}

export function getDb(): Database {
  if (!_db) {
    const dbPath = process.env.RAG_DB_PATH ?? "data/rag.sqlite";
    _db = openDb(dbPath);
  }

  if (!_initialized) {
    initDb();
  }

  return _db;
}

export function closeDb(): void {
  if (_db) {
    _db.close();
  }
  _db = null;
  _initialized = false;
}
