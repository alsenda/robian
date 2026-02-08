import { z } from "zod";
import type { RagQueryResult, RagService } from "../../rag/types.ts";

function zodIssuesToDetails(issues: Array<{ path?: Array<string | number>; message?: string }>): Array<{ field: string; message: string }> {
  return (Array.isArray(issues) ? issues : []).map((i) => {
    const field = Array.isArray(i.path) && i.path.length ? i.path.map(String).join(".") : "input";
    const message = String(i.message || "Invalid value");
    return { field, message };
  });
}

function invalidInput(details: Array<{ field: string; message: string }>, query = ""): RagQueryResult {
  return {
    ok: false,
    query,
    results: [],
    error: {
      kind: "invalid_input",
      message: details[0]?.message || "Invalid input",
      details,
    },
  };
}

function parseTopK(value: unknown): { ok: true; topK: number } | { ok: false; message: string } {
  if (value === undefined || value === null) { return { ok: true, topK: 8 }; }

  const raw = typeof value === "string" ? value.trim() : value;
  if (raw === "") { return { ok: true, topK: 8 }; }

  const n = typeof raw === "number" ? raw : Number(raw);
  if (!Number.isFinite(n)) { return { ok: false, message: "topK must be a number" }; }

  const i = Math.floor(n);
  if (i < 1 || i > 50) { return { ok: false, message: "topK must be between 1 and 50" }; }
  return { ok: true, topK: i };
}

function normalizeSourceId(value: unknown): { ok: true; sourceId?: string } | { ok: false; message: string } {
  if (value === undefined || value === null) { return { ok: true }; }
  const s = String(value).trim();
  if (!s) { return { ok: true }; }
  const uuidOk = z.string().uuid().safeParse(s).success;
  if (!uuidOk) { return { ok: false, message: "sourceId must be a UUID" }; }
  return { ok: true, sourceId: s };
}

export const ragSearchUploadsDef = {
  name: "rag_search_uploads",
  description:
    "Semantic search over local uploaded documents (RAG). query must be non-empty (after trimming). topK is a number (1-50). sourceId is optional (UUID) to scope to a specific upload; omit it to search across all uploads. Returns citation-ready metadata per result (filename, pageStart/pageEnd, chunkId, score).",
  inputSchema: z.object({
    // IMPORTANT: Keep schemas JSON-Schema representable (no transforms/preprocess/refine)
    // because the chat layer serializes tool schemas to JSON Schema.
    query: z.string(),
    topK: z.union([z.number(), z.string()]).optional(),
    sourceId: z.union([z.string(), z.null()]).optional(),
  }),
};

export interface RagSearchUploadsTool {
  name: string;
  description: string;
  inputSchema: typeof ragSearchUploadsDef.inputSchema;
  execute: (input: unknown) => Promise<RagQueryResult>;
}

export function createRagSearchUploadsTool({ rag }: { rag: RagService }): RagSearchUploadsTool {
  return {
    ...ragSearchUploadsDef,
    async execute(input: unknown): Promise<RagQueryResult> {
      const parsed = ragSearchUploadsDef.inputSchema.safeParse(input);
      if (!parsed.success) {
        const details = zodIssuesToDetails(parsed.error.issues as any);
        return invalidInput(details, "");
      }

      const query = String(parsed.data.query ?? "").trim();
      if (!query) {
        return invalidInput([{ field: "query", message: "query must be non-empty" }], "");
      }

      const topKParsed = parseTopK(parsed.data.topK);
      if (!topKParsed.ok) {
        return invalidInput([{ field: "topK", message: topKParsed.message }], query);
      }

      const sourceIdParsed = normalizeSourceId(parsed.data.sourceId);
      if (!sourceIdParsed.ok) {
        return invalidInput([{ field: "sourceId", message: sourceIdParsed.message }], query);
      }

      const topK = topKParsed.topK;
      const sourceId = sourceIdParsed.sourceId;

      try {
        return await rag.query(query, topK, {
          source: "upload",
          ...(sourceId ? { sourceId } : {}),
        });
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : "RAG unavailable";
        return {
          ok: false,
          query,
          results: [],
          error: { kind: "rag_unavailable", message },
        };
      }
    },
  };
}
