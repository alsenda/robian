import { normalizeText } from "./normalize.ts";
import { chunkText, type ChunkOptions, type TextChunk } from "./chunk.ts";

import type { PdfPageText } from "../extract/pdf.ts";

export type PdfChunk = TextChunk & { pageStart?: number; pageEnd?: number };

interface PageSpan { pageNumber: number; start: number; end: number; }

export function chunkPdfPages(
  pages: PdfPageText[],
  opts?: ChunkOptions,
): { normalizedText: string; chunks: PdfChunk[] } {
  const inputPages = Array.isArray(pages) ? pages : [];

  const normalizedPages = inputPages.map((p) => {
    return {
      pageNumber: p.pageNumber,
      text: normalizeText(p.text ?? ""),
    };
  });

  const pageSeparator = "\n\n";

  let normalizedText = "";
  const pageSpans: PageSpan[] = [];

  for (let i = 0; i < normalizedPages.length; i++) {
    const p = normalizedPages[i]!;

    const pageStartOffset = normalizedText.length;
    normalizedText += p.text;
    const pageEndOffset = normalizedText.length;

    pageSpans.push({ pageNumber: p.pageNumber, start: pageStartOffset, end: pageEndOffset });

    if (i !== normalizedPages.length - 1) {
      normalizedText += pageSeparator;
    }
  }

  const chunks = chunkText(normalizedText, opts);

  const pdfChunks: PdfChunk[] = chunks.map((c) => {
    let pageStart: number | undefined;
    let pageEnd: number | undefined;

    for (const ps of pageSpans) {
      const intersects = c.charEnd > ps.start && c.charStart < ps.end;
      if (!intersects) { continue; }

      if (pageStart === undefined) { pageStart = ps.pageNumber; }
      pageEnd = ps.pageNumber;
    }

    const out: PdfChunk = { ...c };
    if (pageStart !== undefined) { out.pageStart = pageStart; }
    if (pageEnd !== undefined) { out.pageEnd = pageEnd; }
    return out;
  });

  return { normalizedText, chunks: pdfChunks };
}
