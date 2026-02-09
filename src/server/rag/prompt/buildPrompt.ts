export interface RetrievedChunk {
  chunkId: string;
  documentId: string;
  filename: string;
  pageStart?: number | null;
  pageEnd?: number | null;
  content: string;
  score: number;
}

function oneLine(input: string): string {
  return String(input || "")
    .replace(/[\r\n\t]+/g, " ")
    .replace(/\s{2,}/g, " ")
    .trim();
}

function formatPageRange(pageStart?: number | null, pageEnd?: number | null): string {
  const start = typeof pageStart === "number" && Number.isFinite(pageStart) ? Math.floor(pageStart) : null;
  const end = typeof pageEnd === "number" && Number.isFinite(pageEnd) ? Math.floor(pageEnd) : null;

  if (start == null) { return ""; }
  if (end == null || end === start) { return ` p.${start}`; }
  return ` p.${start}-${end}`;
}

function sourceTag(chunk: Pick<RetrievedChunk, "filename" | "pageStart" | "pageEnd">): string {
  const filename = oneLine(chunk.filename);
  const pages = formatPageRange(chunk.pageStart, chunk.pageEnd);
  const chunkId = (chunk as any)?.chunkId ? oneLine(String((chunk as any).chunkId)) : "";
  // Keep the citation format strict and machine-parseable.
  // Example: [source: contract.pdf p.12-13 chunk:abc123]
  return chunkId
    ? `[source: ${filename}${pages} chunk:${chunkId}]`
    : `[source: ${filename}${pages}]`;
}

export function buildRagPrompt(input: { question: string; chunks: RetrievedChunk[] }): string {
  const question = oneLine(input.question);
  const chunks = Array.isArray(input.chunks) ? input.chunks : [];

  const contextLines: string[] = [];
  for (let i = 0; i < chunks.length; i++) {
    const c = chunks[i]!;
    const content = oneLine(c.content);
    contextLines.push(`${i + 1}) ${sourceTag(c)} ${content}`);
  }

  const hasContext = contextLines.length > 0;

  return (
    `RAG Grounded Scripture Assistant\n` +
    `Answer ONLY using the provided context snippets from the user's uploaded documents.\n` +
    `Do not use outside knowledge. Do not guess. Refusal is preferred over fabrication.\n` +
    `\n` +
    `Mode separation (never mix modes):\n` +
    `- Quote Mode (extractive only): Use ONLY verbatim text that appears in the provided context. No paraphrase, no summarization, no completing missing words.\n` +
    `- Explanation Mode: You may summarize or interpret, but ONLY based on the provided context. Clearly distinguish interpretation from quoted text.\n` +
    `If the user asks for exact verses, verbatim text, chapter/verse references, or direct quotations, you MUST use Quote Mode.\n` +
    `If the user asks for both quotation and explanation, ask them to choose Quote Mode or Explanation Mode before answering.\n` +
    `\n` +
    `Citations are required for grounded answers.\n` +
    `Citation format (STRICT): [source: <filename> p.<start>-<end> chunk:<chunkId>]\n` +
    `- Use ONLY chunk ids that appear in the provided context.\n` +
    `- Every sentence that states a fact from the context must include at least one citation.\n` +
    `- Do not invent filenames, page ranges, or chunk ids.\n` +
    `\n` +
    `Exact-quote failure rule: If you cannot find the exact requested passage verbatim in the context, respond with: ` +
    `"I cannot find this exact passage in the uploaded files."\n` +
    `General refusal template (use when refusing due to missing/ambiguous context): ` +
    `"I cannot provide this information because it is not present verbatim in the uploaded documents."\n` +
    `\n` +
    `Self-verification requirement: Before finalizing, ensure every quoted sentence appears verbatim in the context snippets.\n` +
    `If any part cannot be verified verbatim, remove it and refuse using the templates above.\n` +
    `\n` +
    `If the context does not contain enough information to answer, refuse using the template and ask what document to upload or what to search.\n` +
    `\n` +
    `Question: ${question}\n` +
    `\n` +
    `Context:\n` +
    (hasContext ? contextLines.join("\n") : "(no context snippets were retrieved)") +
    `\n\n` +
    `Answer:`
  );
}
