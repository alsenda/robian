-- Vector store schema (documents/chunks + sqlite-vec virtual table)

CREATE TABLE IF NOT EXISTS documents (
  id TEXT PRIMARY KEY,
  userId TEXT NOT NULL,
  filename TEXT NOT NULL,
  mimeType TEXT,
  byteSize INTEGER,
  sha256 TEXT NOT NULL,
  createdAt INTEGER NOT NULL,
  status TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS documents_userId_sha256 ON documents (userId, sha256);

CREATE TABLE IF NOT EXISTS chunks (
  id TEXT PRIMARY KEY,
  documentId TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  chunkIndex INTEGER NOT NULL,
  content TEXT NOT NULL,
  pageStart INTEGER,
  pageEnd INTEGER,
  charStart INTEGER,
  charEnd INTEGER,
  createdAt INTEGER NOT NULL,
  UNIQUE(documentId, chunkIndex)
);

CREATE INDEX IF NOT EXISTS chunks_documentId ON chunks (documentId);
CREATE INDEX IF NOT EXISTS chunks_documentId_chunkIndex ON chunks (documentId, chunkIndex);

-- sqlite-vec virtual table
CREATE VIRTUAL TABLE IF NOT EXISTS chunk_vectors USING vec0(
  embedding float[$EMBEDDING_DIM$],
  chunkId TEXT
);
