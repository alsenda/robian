import { extractTextFromPdf, type PdfPageText } from './pdf.ts'

export async function extractTextFromUpload(
  mimeType: string,
  buffer: Buffer,
): Promise<{ text: string; pages?: PdfPageText[]; isLikelyScanned?: boolean }> {
  const mt = String(mimeType || '').toLowerCase().trim()

  if (mt === 'application/pdf') {
    const out = await extractTextFromPdf(buffer)
    return { text: out.text, pages: out.pages, isLikelyScanned: out.isLikelyScanned }
  }

  // Best-effort text fallback for common text-like uploads.
  if (mt.startsWith('text/') || mt === 'application/json' || mt === 'application/xml') {
    try {
      return { text: Buffer.from(buffer).toString('utf8') }
    } catch {
      return { text: '' }
    }
  }

  // TODO: Add other extractors (docx, html) and filename-based detection.
  return { text: '' }
}
