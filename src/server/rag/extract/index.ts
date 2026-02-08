import { extractTextFromPdf, type PdfPageText } from "./pdf.ts";

function isDebugRagPdfEnabled(): boolean {
  const raw = String(process.env.DEBUG_RAG_PDF || "").trim().toLowerCase();
  return raw === "1" || raw === "true" || raw === "yes";
}

function debugRagPdf(event: string, data: Record<string, unknown>): void {
  if (!isDebugRagPdfEnabled()) { return; }
  try {
    console.log(JSON.stringify({ tag: "rag_pdf", scope: "rag.extract", event, ...data }));
  } catch {
    // ignore
  }
}

export async function extractTextFromUpload(
  mimeType: string,
  buffer: Buffer,
): Promise<{ text: string; pages?: PdfPageText[]; isLikelyScanned?: boolean }> {
  const mt = String(mimeType || "").toLowerCase().trim();

  debugRagPdf("extract_called", {
    mimeType,
    normalizedMimeType: mt,
    bufferIsBuffer: Buffer.isBuffer(buffer),
    bufferType: (buffer as any)?.constructor?.name,
    bufferByteLength: (buffer as any)?.byteLength,
    bufferLength: (buffer as any)?.length,
  });

  if (mt === "application/pdf") {
    debugRagPdf("extract_branch", { normalizedMimeType: mt, branch: "pdf" });
    const out = await extractTextFromPdf(buffer);
    return { text: out.text, pages: out.pages, isLikelyScanned: out.isLikelyScanned };
  }

  // Best-effort text fallback for common text-like uploads.
  if (mt.startsWith("text/") || mt === "application/json" || mt === "application/xml") {
    debugRagPdf("extract_branch", { normalizedMimeType: mt, branch: "text_fallback" });
    try {
      return { text: Buffer.from(buffer).toString("utf8") };
    } catch {
      return { text: "" };
    }
  }

  // TODO: Add other extractors (docx, html) and filename-based detection.
  debugRagPdf("extract_branch", { normalizedMimeType: mt, branch: "none" });
  return { text: "" };
}
