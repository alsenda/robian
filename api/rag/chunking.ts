export type RagChunk = {
  chunkIndex: number
  text: string
}

export function chunkText(
  text: string,
  chunkSizeChars: number,
  overlapChars: number,
): RagChunk[] {
  const input = String(text ?? '')
  const size = Number.isFinite(chunkSizeChars) && chunkSizeChars > 0 ? Math.floor(chunkSizeChars) : 1200
  const overlapRaw =
    Number.isFinite(overlapChars) && overlapChars >= 0 ? Math.floor(overlapChars) : 0
  const overlap = Math.min(Math.max(0, overlapRaw), Math.max(0, size - 1))

  if (!input) return []

  const out: RagChunk[] = []
  let start = 0
  let index = 0
  while (start < input.length) {
    const end = Math.min(input.length, start + size)
    const chunk = input.slice(start, end)
    if (chunk.length > 0) {
      out.push({ chunkIndex: index, text: chunk })
      index += 1
    }

    if (end >= input.length) break

    const nextStart = Math.max(0, end - overlap)
    // If overlap would prevent progress, fall back to non-overlap stepping.
    start = nextStart <= start ? end : nextStart
  }

  return out
}
