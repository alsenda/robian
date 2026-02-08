import { describe, expect, it } from 'vitest'

import { chunkPdfPages } from '../../../src/server/rag/text/chunkPdf.ts'
import type { PdfPageText } from '../../../src/server/rag/extract/pdf.ts'

describe('chunkPdfPages', () => {
  it('assigns correct pageStart/pageEnd for 2 pages', () => {
    const pages: PdfPageText[] = [
      { pageNumber: 1, text: 'A'.repeat(80) },
      { pageNumber: 2, text: 'B'.repeat(80) },
    ]

    const out = chunkPdfPages(pages, { maxChars: 120, overlapChars: 0, minChunkChars: 10, separators: ['\n\n', ' '] })

    expect(out.chunks.length).toBeGreaterThan(1)

    // First chunk should span end of page 1 into page 2 due to packing/splitting.
    expect(out.chunks[0]!.pageStart).toBe(1)
    expect(out.chunks[0]!.pageEnd).toBe(2)

    // Second chunk should be only page 2 remainder.
    expect(out.chunks[out.chunks.length - 1]!.pageStart).toBe(2)
    expect(out.chunks[out.chunks.length - 1]!.pageEnd).toBe(2)
  })

  it('includes a case where a chunk spans page 1 into page 2', () => {
    const pages: PdfPageText[] = [
      { pageNumber: 1, text: 'Page1 '.repeat(20) },
      { pageNumber: 2, text: 'Page2 '.repeat(20) },
    ]

    const out = chunkPdfPages(pages, { maxChars: 140, overlapChars: 0, minChunkChars: 10, separators: ['\n\n', ' '] })

    const spanning = out.chunks.find((c) => c.pageStart === 1 && c.pageEnd === 2)
    expect(spanning).toBeTruthy()
  })
})
