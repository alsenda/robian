import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import type { Database } from './types.ts'
import { EMBEDDING_DIM } from './constants.ts'

function migrationsDirPath(): string {
  const dir = fileURLToPath(new URL('./migrations', import.meta.url))
  return dir
}

function listMigrationFiles(): string[] {
  const dir = migrationsDirPath()
  if (!fs.existsSync(dir)) return []
  return fs
    .readdirSync(dir)
    .filter((f) => f.toLowerCase().endsWith('.sql'))
    .sort((a, b) => a.localeCompare(b))
    .map((f) => path.join(dir, f))
}

function readSql(filePath: string): string {
  const raw = fs.readFileSync(filePath, 'utf8')
  return raw.replace(/\$EMBEDDING_DIM\$/g, String(EMBEDDING_DIM))
}

export function runMigrations(db: Database): void {
  db.exec(
    `
CREATE TABLE IF NOT EXISTS schema_migrations (
  id TEXT PRIMARY KEY,
  appliedAt INTEGER NOT NULL
);
`.trim(),
  )

  const applied = new Set<string>()
  for (const row of db.prepare('SELECT id FROM schema_migrations').all() as Array<{ id: string }>) {
    if (row?.id) applied.add(String(row.id))
  }

  const files = listMigrationFiles()
  for (const filePath of files) {
    const id = path.basename(filePath)
    if (applied.has(id)) continue

    const sql = readSql(filePath)

    const tx = db.transaction(() => {
      db.exec(sql)
      db.prepare('INSERT INTO schema_migrations (id, appliedAt) VALUES (?, ?)').run(id, Date.now())
    })

    tx()
  }
}
