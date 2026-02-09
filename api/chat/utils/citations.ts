export interface ParsedCitation {
  raw: string;
  filename?: string;
  pageStart?: number;
  pageEnd?: number;
  chunkId?: string;
}

export interface AllowedChunkRef {
  chunkId: string;
  filename: string;
  pageStart?: number | null;
  pageEnd?: number | null;
}

function toInt(value: string | undefined): number | undefined {
  if (!value) { return undefined; }
  const n = Number(value);
  if (!Number.isFinite(n)) { return undefined; }
  return Math.floor(n);
}

function normalizeFilename(name: string): string {
  return String(name || "").trim().toLowerCase();
}

export function extractCitations(text: string): ParsedCitation[] {
  const s = String(text ?? "");
  const matches = s.match(/\[source:[^\]]+\]/gi);
  if (!matches) { return []; }

  const out: ParsedCitation[] = [];
  for (const raw of matches) {
    const inner = raw.replace(/^\[source:/i, "").replace(/\]$/, "").trim();

    let left = inner;
    let chunkId: string | undefined;
    const chunkIdx = inner.toLowerCase().lastIndexOf("chunk:");
    if (chunkIdx >= 0) {
      left = inner.slice(0, chunkIdx).trim();
      chunkId = inner.slice(chunkIdx + "chunk:".length).trim() || undefined;
    }

    let filenamePart = left;
    let pageStart: number | undefined;
    let pageEnd: number | undefined;

    const pageMatch = left.match(/\bp\.(\d+)(?:-(\d+))?\b/i);
    if (pageMatch) {
      pageStart = toInt(pageMatch[1]);
      pageEnd = toInt(pageMatch[2]) ?? pageStart;
      filenamePart = left.replace(pageMatch[0], "").trim();
    }

    const filename = filenamePart ? filenamePart.replace(/\s{2,}/g, " ").trim() : undefined;

    out.push({ raw, filename, pageStart, pageEnd, chunkId });
  }

  return out;
}

export interface CitationValidationResult {
  ok: boolean;
  citations: ParsedCitation[];
  missingChunkIds: ParsedCitation[];
  invalidChunkIds: ParsedCitation[];
  filenameMismatches: ParsedCitation[];
}

export function validateCitationsAgainstAllowlist({
  text,
  allowedChunks,
  requireChunkIds,
}: {
  text: string;
  allowedChunks: AllowedChunkRef[];
  requireChunkIds: boolean;
}): CitationValidationResult {
  const citations = extractCitations(text);

  const allowedById = new Map<string, AllowedChunkRef>();
  for (const c of Array.isArray(allowedChunks) ? allowedChunks : []) {
    const id = String(c.chunkId || "").trim();
    if (!id) { continue; }
    allowedById.set(id, c);
  }

  const missingChunkIds: ParsedCitation[] = [];
  const invalidChunkIds: ParsedCitation[] = [];
  const filenameMismatches: ParsedCitation[] = [];

  for (const c of citations) {
    const id = String(c.chunkId || "").trim();
    if (!id) {
      if (requireChunkIds) { missingChunkIds.push(c); }
      continue;
    }

    const allowed = allowedById.get(id);
    if (!allowed) {
      invalidChunkIds.push(c);
      continue;
    }

    if (c.filename) {
      const cited = normalizeFilename(c.filename);
      const actual = normalizeFilename(allowed.filename);
      if (cited && actual && cited !== actual) {
        filenameMismatches.push(c);
      }
    }
  }

  const ok =
    citations.length > 0 &&
    missingChunkIds.length === 0 &&
    invalidChunkIds.length === 0 &&
    filenameMismatches.length === 0;

  return { ok, citations, missingChunkIds, invalidChunkIds, filenameMismatches };
}
