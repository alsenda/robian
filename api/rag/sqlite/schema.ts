export const MIGRATIONS: string[] = [
  `
CREATE TABLE IF NOT EXISTS rag_chunks (
  id TEXT PRIMARY KEY,
  docId TEXT NOT NULL,
  source TEXT NOT NULL,
  sourceId TEXT NOT NULL,
  title TEXT,
  mimeType TEXT,
  createdAt TEXT NOT NULL,
  chunkIndex INTEGER NOT NULL,
  text TEXT NOT NULL,
  metaJson TEXT,
  embeddingJson TEXT NOT NULL
);
`.trim(),
  "CREATE INDEX IF NOT EXISTS rag_chunks_source_sourceId ON rag_chunks (source, sourceId);",
  "CREATE INDEX IF NOT EXISTS rag_chunks_docId ON rag_chunks (docId);",
];

// Back-compat aliases (older internal names)
export const RAG_SCHEMA_MIGRATIONS: string[] = MIGRATIONS;
export const RAG_SCHEMA_SQL = `
${MIGRATIONS.join("\n\n")}
`;
