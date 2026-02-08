# Uploads feature (scaffolding)

This module adds a dev-friendly uploads pipeline with a small on-disk manifest. It is intentionally designed so that **real parsing + embeddings + vector search** can be added later without changing the HTTP API or the LLM tool surface.

## Where files are stored

- Default uploads directory: `.data/uploads` (relative to the repo root)
- Override with: `UPLOADS_DIR=/absolute/or/relative/path`

Files are saved with a generated UUID id as the basename:

- Stored filename: `<id>.<ext>`
- Example: `b6c8...-...-....txt`

## Manifest store

The manifest lives next to the files:

- `manifest.json`

Entries look like:

```json
{
  "id": "...",
  "originalName": "report.pdf",
  "storedName": "<id>.pdf",
  "mimeType": "application/pdf",
  "sizeBytes": 123,
  "createdAt": "2026-02-08T...Z",
  "sha256": "...",
  "extension": "pdf",
  "extractable": false,
  "previewText": ""
}
```

The manifest is a simple JSON file written atomically (`manifest.json.tmp` then rename). No database dependency is required.

## Parsing (current behavior)

- Text-like files (`txt`, `md`, `csv`, `json`) store a UTF-8 `previewText` up to 20,000 chars.
- Binary files (`pdf`, `docx`, `xlsx`, etc.) are **not** parsed yet: `extractable:false` and empty `previewText`.

This is deliberate to avoid hallucinating file contents and to keep dependencies minimal.

## RAG (future work)

The RAG tool (`rag_search_uploads`) and module (`api/uploads/rag/index.stub.js`) currently always returns:

- `ok:false`
- `error.kind:"not_implemented"`
- `results: []`

To implement RAG later without changing the API surface:

1. Add real extraction for binary formats (PDF/Office) under `api/uploads/parsing/`.
2. Add an embeddings pipeline + vector index (or external DB).
3. Update `api/uploads/rag/index.stub.js` to query that index and return real `results`.
4. Keep tool name + input/output shapes unchanged.
