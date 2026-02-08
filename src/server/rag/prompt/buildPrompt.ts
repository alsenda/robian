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
  return `[source: ${filename}${pages}]`;
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
    `You are a helpful assistant. Answer ONLY using the provided context.\n` +
    `Do not use outside knowledge. Do not guess.\n` +
    `\n` +
    `Citations: Every sentence that states a fact must include an inline citation like [source: filename p.12].\n` +
    `If a page range is available, cite it like [source: filename p.12-13].\n` +
    `\n` +
    `If the context does not contain enough information to answer, say you don't have enough information in the provided documents, ` +
    `and ask what document to upload or what to search.\n` +
    `\n` +
    `Question: ${question}\n` +
    `\n` +
    `Context:\n` +
    (hasContext ? contextLines.join("\n") : "(no context snippets were retrieved)") +
    `\n\n` +
    `Answer:`
  );
}
