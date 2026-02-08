export interface ChunkOptions {
  maxChars?: number; // default 2000
  overlapChars?: number; // default 200
  minChunkChars?: number; // default 300 (merge/avoid tiny chunks)
  separators?: string[]; // default ["\n\n", "\n", ". ", " "]
}

export interface TextChunk {
  chunkIndex: number;
  content: string;
  charStart: number;
  charEnd: number;
}

interface Span { start: number; end: number; }

type ResolvedChunkOptions = Required<ChunkOptions>;

function resolveOptions(opts?: ChunkOptions): ResolvedChunkOptions {
  const maxCharsRaw = opts?.maxChars ?? 2000;
  const overlapRaw = opts?.overlapChars ?? 200;
  const minRaw = opts?.minChunkChars ?? 300;
  const seps = opts?.separators ?? ["\n\n", "\n", ". ", " "];

  const maxChars = Number.isFinite(maxCharsRaw) && maxCharsRaw > 0 ? Math.floor(maxCharsRaw) : 2000;
  const overlapChars0 = Number.isFinite(overlapRaw) && overlapRaw >= 0 ? Math.floor(overlapRaw) : 200;
  const overlapChars = Math.min(Math.max(0, overlapChars0), Math.max(0, maxChars - 1));

  const minChunkChars = Number.isFinite(minRaw) && minRaw >= 0 ? Math.floor(minRaw) : 300;

  const separators = Array.isArray(seps) ? seps.filter((s) => typeof s === "string" && s.length > 0) : ["\n\n", "\n", ". ", " "];

  return {
    maxChars,
    overlapChars,
    minChunkChars,
    separators,
  };
}

function splitSpanBySeparator(text: string, span: Span, sep: string): Span[] {
  const out: Span[] = [];
  let cursor = span.start;

  while (cursor < span.end) {
    const idx = text.indexOf(sep, cursor);
    if (idx === -1 || idx >= span.end) { break; }

    const end = Math.min(span.end, idx + sep.length);
    if (end > cursor) { out.push({ start: cursor, end }); }
    cursor = end;
  }

  if (cursor < span.end) { out.push({ start: cursor, end: span.end }); }

  return out.length > 0 ? out : [span];
}

function hardSplitSpan(span: Span, maxChars: number): Span[] {
  const out: Span[] = [];
  let cursor = span.start;
  while (cursor < span.end) {
    const end = Math.min(span.end, cursor + maxChars);
    out.push({ start: cursor, end });
    cursor = end;
  }
  return out;
}

function trimSlicePreservingOffsets(text: string, start: number, end: number): { content: string; charStart: number; charEnd: number } | null {
  const slice = text.slice(start, end);
  if (!slice) { return null; }

  const left = slice.search(/\S/);
  if (left === -1) { return null; }

  // Count trailing whitespace
  const m = slice.match(/\s+$/);
  const trailing = m ? m[0].length : 0;

  const charStart = start + left;
  const charEnd = end - trailing;
  if (charEnd <= charStart) { return null; }

  const content = text.slice(charStart, charEnd);
  if (!content) { return null; }

  return { content, charStart, charEnd };
}

function materializeChunks(text: string, spans: Span[]): Array<{ start: number; end: number; content: string; charStart: number; charEnd: number }> {
  const out: Array<{ start: number; end: number; content: string; charStart: number; charEnd: number }> = [];
  for (const sp of spans) {
    const t = trimSlicePreservingOffsets(text, sp.start, sp.end);
    if (!t) { continue; }
    out.push({ start: sp.start, end: sp.end, ...t });
  }
  return out;
}

function mergeTinyNonFinalChunks(text: string, chunks: Span[], minChunkChars: number, maxChars: number): Span[] {
  if (chunks.length <= 1) { return chunks; }

  const out: Span[] = [];
  let i = 0;
  while (i < chunks.length) {
    const cur = chunks[i]!;
    const isLast = i === chunks.length - 1;

    if (!isLast && cur.end - cur.start < minChunkChars) {
      const next = chunks[i + 1]!;
      const merged: Span = { start: cur.start, end: next.end };
      if (merged.end - merged.start <= maxChars) {
        out.push(merged);
        i += 2;
        continue;
      }

      // If merging would exceed maxChars, try to keep current and continue.
      // (This should be rare; packing tries to fill chunks already.)
    }

    out.push(cur);
    i += 1;
  }

  // If merge created a tiny second-to-last chunk, allow it; spec only forbids tiny chunks unless final remainder.
  // That case can happen with pathological inputs; keep deterministic.
  return out;
}

export function chunkText(input: string, opts?: ChunkOptions): TextChunk[] {
  const text = String(input ?? "");
  const options = resolveOptions(opts);

  if (!text) { return []; }

  // 1) Build spans by recursively splitting only spans larger than maxChars.
  let spans: Span[] = [{ start: 0, end: text.length }];
  for (const sep of options.separators) {
    const next: Span[] = [];
    for (const sp of spans) {
      const len = sp.end - sp.start;
      if (len <= options.maxChars) {
        next.push(sp);
        continue;
      }

      const split = splitSpanBySeparator(text, sp, sep);
      // If separator did not help, keep as-is.
      if (split.length === 1) {
        next.push(sp);
      } else {
        next.push(...split);
      }
    }
    spans = next;
  }

  // 2) Hard split any remaining oversized spans.
  {
    const next: Span[] = [];
    for (const sp of spans) {
      if (sp.end - sp.start > options.maxChars) {
        next.push(...hardSplitSpan(sp, options.maxChars));
      } else {
        next.push(sp);
      }
    }
    spans = next;
  }

  // 3) Pack spans into maxChars chunks, splitting a span prefix if needed to fill space.
  const packed: Span[] = [];
  let i = 0;
  while (i < spans.length) {
    const start = spans[i]!.start;
    let end = spans[i]!.end;

    while (i + 1 < spans.length) {
      const next = spans[i + 1]!;
      const curLen = end - start;
      const nextLen = next.end - next.start;
      if (curLen + nextLen <= options.maxChars) {
        end = next.end;
        i += 1;
        continue;
      }

      const available = options.maxChars - curLen;
      if (available > 0) {
        // Consume a prefix of the next span to fill the current chunk.
        const prefix: Span = { start: next.start, end: next.start + available };
        const remainder: Span = { start: next.start + available, end: next.end };

        end = prefix.end;
        // Replace next span with remainder so it gets processed next.
        spans[i + 1] = remainder;
      }

      break;
    }

    packed.push({ start, end });
    i += 1;
  }

  // 4) Merge tiny non-final chunks where possible.
  const mergedPacked = mergeTinyNonFinalChunks(text, packed, options.minChunkChars, options.maxChars);

  // 5) Apply overlap on packed spans.
  const overlapped: Span[] = mergedPacked.map((sp, idx) => {
    if (idx === 0) { return sp; }
    const start = Math.max(0, sp.start - options.overlapChars);
    return { start, end: sp.end };
  });

  // 6) Materialize chunks, trimming but preserving normalized-text offsets.
  const materialized = materializeChunks(text, overlapped);

  // 7) Ensure sequential chunkIndex and no empties.
  return materialized.map((c, idx) => ({
    chunkIndex: idx,
    content: c.content,
    charStart: c.charStart,
    charEnd: c.charEnd,
  }));
}
