import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'

import { RAG_SCHEMA_SQL } from './schema.ts'

export type SqliteStatement = {
  run: (...args: unknown[]) => { changes: number }
  all: (...args: unknown[]) => unknown[]
}

export type SqliteDb = {
  exec: (sql: string) => void
  prepare: (sql: string) => SqliteStatement
  close: () => void
}

function resolveDbPath(dbPath: string): string {
  const p = String(dbPath || '').trim() || 'data/rag.sqlite'
  return path.isAbsolute(p) ? p : path.resolve(process.cwd(), p)
}

function ensureParentDir(filePath: string): void {
  const dir = path.dirname(filePath)
  fs.mkdirSync(dir, { recursive: true })
}

function loadBetterSqlite3(): unknown {
  const require = createRequire(import.meta.url)
  return require('better-sqlite3') as unknown
}

export function openSqliteDb(dbPath: string): SqliteDb {
  const filePath = resolveDbPath(dbPath)
  ensureParentDir(filePath)

  const mod = loadBetterSqlite3()
  const DatabaseCtor =
    (typeof mod === 'function' ? mod : (mod as { default?: unknown }).default) as unknown

  if (typeof DatabaseCtor !== 'function') {
    throw new Error('Failed to load better-sqlite3')
  }

  const db = new (DatabaseCtor as new (p: string) => SqliteDb)(filePath)

  db.exec(RAG_SCHEMA_SQL)

  return db
}
