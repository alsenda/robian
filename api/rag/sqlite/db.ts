import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'

import type { RagQueryFilters, RagSource } from '../types.ts'
import { MIGRATIONS } from './schema.ts'

export type SqliteStatement = {
  run: (...args: unknown[]) => { changes: number }
  all: (...args: unknown[]) => unknown[]
}

export type SqliteDb = {
  exec: (sql: string) => void
  prepare: (sql: string) => SqliteStatement
  close: () => void
}

export interface RagChunkRow {
  id: string
  docId: string
  source: RagSource
  sourceId: string
  title?: string
  mimeType?: string
  createdAt: string
  chunkIndex: number
  text: string
  metaJson?: string
  embeddingJson: string
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

  return db
}

function buildWhere(filters?: RagQueryFilters): { whereSql: string; params: unknown[] } {
  const clauses: string[] = []
  const params: unknown[] = []

  if (filters?.source) {
    clauses.push('source = ?')
    params.push(filters.source)
  }
  if (filters?.sourceId) {
    clauses.push('sourceId = ?')
    params.push(filters.sourceId)
  }
  if (filters?.mimeType) {
    clauses.push('mimeType = ?')
    params.push(filters.mimeType)
  }

  if (!clauses.length) return { whereSql: '', params }
  return { whereSql: `WHERE ${clauses.join(' AND ')}`, params }
}

function asCandidateRow(row: unknown): RagChunkRow | null {
  if (!row || typeof row !== 'object') return null
  const r = row as Record<string, unknown>

  const id = typeof r.id === 'string' ? r.id : ''
  const docId = typeof r.docId === 'string' ? r.docId : ''
  const source = typeof r.source === 'string' ? r.source : ''
  const sourceId = typeof r.sourceId === 'string' ? r.sourceId : ''
  const title = typeof r.title === 'string' && r.title ? r.title : undefined
  const mimeType = typeof r.mimeType === 'string' && r.mimeType ? r.mimeType : undefined
  const createdAt = typeof r.createdAt === 'string' ? r.createdAt : ''
  const chunkIndex = typeof r.chunkIndex === 'number' && Number.isFinite(r.chunkIndex) ? Math.floor(r.chunkIndex) : -1
  const text = typeof r.text === 'string' ? r.text : ''
  const metaJson = typeof r.metaJson === 'string' && r.metaJson ? r.metaJson : undefined
  const embeddingJson = typeof r.embeddingJson === 'string' ? r.embeddingJson : ''

  if (!id || !docId) return null
  if (source !== 'upload') return null
  if (!sourceId) return null
  if (!createdAt) return null
  if (chunkIndex < 0) return null
  if (!text) return null
  if (!embeddingJson) return null

  return {
    id,
    docId,
    source: source as RagSource,
    sourceId,
    title,
    mimeType,
    createdAt,
    chunkIndex,
    text,
    metaJson,
    embeddingJson,
  }
}

export function openRagSqliteDb(dbPath: string): {
  close(): void
  migrate(): void
  deleteByDocId(docId: string): number
  insertChunk(row: RagChunkRow): void
  selectCandidates(args: { filters?: RagQueryFilters; limit: number }): RagChunkRow[]
  deleteByDocIds(ids: string[]): number
} {
  const db = openSqliteDb(dbPath)

  const migrate = (): void => {
    for (const sql of MIGRATIONS) {
      db.exec(sql)
    }
  }

  migrate()

  const deleteByDocIdStmt = db.prepare('DELETE FROM rag_chunks WHERE docId = ?')
  const insertStmt = db.prepare(
    'INSERT OR REPLACE INTO rag_chunks (id, docId, source, sourceId, title, mimeType, createdAt, chunkIndex, text, metaJson, embeddingJson) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
  )

  return {
    close(): void {
      db.close()
    },

    migrate,

    deleteByDocId(docId: string): number {
      const res = deleteByDocIdStmt.run(String(docId))
      return Number(res.changes) || 0
    },

    insertChunk(row: RagChunkRow): void {
      insertStmt.run(
        row.id,
        row.docId,
        row.source,
        row.sourceId,
        row.title ?? null,
        row.mimeType ?? null,
        row.createdAt,
        row.chunkIndex,
        row.text,
        row.metaJson ?? null,
        row.embeddingJson,
      )
    },

    selectCandidates(args: { filters?: RagQueryFilters; limit: number }): RagChunkRow[] {
      const cap = Number.isFinite(args.limit) && args.limit > 0 ? Math.floor(args.limit) : 1
      const { whereSql, params } = buildWhere(args.filters)
      const sql =
        `SELECT id, docId, source, sourceId, title, mimeType, createdAt, chunkIndex, text, metaJson, embeddingJson ` +
        `FROM rag_chunks ${whereSql} ` +
        `ORDER BY createdAt DESC, chunkIndex ASC ` +
        `LIMIT ?`
      const rows = db.prepare(sql).all(...params, cap)

      const out: RagChunkRow[] = []
      for (const row of rows) {
        const parsed = asCandidateRow(row)
        if (parsed) out.push(parsed)
      }
      return out
    },

    deleteByDocIds(docIds: string[]): number {
      const ids = Array.isArray(docIds) ? docIds.map((d) => String(d)).filter(Boolean) : []
      if (ids.length === 0) return 0
      const placeholders = ids.map(() => '?').join(',')
      const stmt = db.prepare(`DELETE FROM rag_chunks WHERE docId IN (${placeholders})`)
      const res = stmt.run(...ids)
      return Number(res.changes) || 0
    },
  }
}
