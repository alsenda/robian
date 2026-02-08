import { isTextLikeExtension } from "../security/allowedTypes.ts";

export function extractPreviewText({
  buffer,
  extension,
  maxChars,
}: {
  buffer: Uint8Array | Buffer
  extension: string
  maxChars?: number,
}): { extractable: boolean; previewText: string } {
  const ext = String(extension || "").toLowerCase();
  const max = typeof maxChars === "number" ? maxChars : Number.NaN;
  const limit = Number.isFinite(max) && max > 0 ? Math.floor(max) : 20_000;

  if (!isTextLikeExtension(ext)) {
    return { extractable: false, previewText: "" };
  }

  try {
    const text = Buffer.from(buffer).toString("utf8");
    return { extractable: true, previewText: text.slice(0, limit) };
  } catch {
    return { extractable: true, previewText: "" };
  }
}
