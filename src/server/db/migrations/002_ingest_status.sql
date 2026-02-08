-- Per-upload ingestion status (for UI + retry)

CREATE TABLE IF NOT EXISTS ingest_status (
  documentId TEXT PRIMARY KEY,
  userId TEXT NOT NULL,
  status TEXT NOT NULL,
  jobId TEXT,
  lastError TEXT,
  isLikelyScanned INTEGER,
  createdAt INTEGER NOT NULL,
  updatedAt INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS ingest_status_userId_status ON ingest_status (userId, status);
