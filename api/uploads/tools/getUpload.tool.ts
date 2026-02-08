import { z } from "zod";
import { getManifestEntry } from "../db/manifest.ts";

export const getUploadDef = {
  name: "get_upload",
  description:
    "Get upload metadata and (if text-like) a previewText snippet. For PDFs/Office files, previewText is empty unless parsing is implemented.",
  inputSchema: z.object({ id: z.string().min(1), maxChars: z.number().int().positive().optional() }),
};

export const getUploadTool = {
  ...getUploadDef,
  async execute(input: unknown): Promise<unknown> {
    const parsed = getUploadDef.inputSchema.safeParse(input);
    if (!parsed.success) {
      return { ok: false, error: { message: "Invalid input" } };
    }

    const { id, maxChars } = parsed.data;
    const entry = await getManifestEntry(String(id));
    if (!entry) {
      return { ok: false, error: { message: "Upload not found" } };
    }

    const limit = typeof maxChars === "number" ? Math.min(20_000, maxChars) : 20_000;
    const previewText = entry.previewText ? String(entry.previewText).slice(0, limit) : "";
    return { ok: true, upload: entry, previewText };
  },
};
