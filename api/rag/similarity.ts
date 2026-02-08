export function cosineSimilarity(a: number[], b: number[]): number {
  if (!Array.isArray(a) || !Array.isArray(b) || a.length === 0 || b.length === 0) { return -1; }
  if (a.length !== b.length) { return -1; }

  let dot = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < a.length; i++) {
    const av = a[i];
    const bv = b[i];
    if (typeof av !== "number" || typeof bv !== "number") { return -1; }
    if (!Number.isFinite(av) || !Number.isFinite(bv)) { return -1; }

    dot += av * bv;
    normA += av * av;
    normB += bv * bv;
  }

  if (normA <= 0 || normB <= 0) { return -1; }
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}
