export type Statement = {
  run: (...args: unknown[]) => { changes: number; lastInsertRowid?: unknown }
  get: (...args: unknown[]) => unknown
  all: (...args: unknown[]) => unknown[]
}

export type Database = {
  exec: (sql: string) => void
  prepare: (sql: string) => Statement
  close: () => void
  pragma: (pragma: string) => unknown
  loadExtension: (filePath: string, entryPoint?: string) => void
  transaction: <T>(fn: () => T) => () => T
}
