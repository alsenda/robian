import { describe, expect, it } from "vitest";

import { chunkText } from "../../../src/server/rag/text/chunk.ts";

describe("chunkText", () => {
  it("produces chunks respecting maxChars", () => {
    const input = "A".repeat(250);
    const chunks = chunkText(input, { maxChars: 100, overlapChars: 0, minChunkChars: 10 });

    expect(chunks.length).toBeGreaterThan(1);
    for (const c of chunks) {
      expect(c.charEnd - c.charStart).toBeLessThanOrEqual(100);
      expect(c.content.length).toBeGreaterThan(0);
    }
  });

  it("produces overlap between adjacent chunks", () => {
    const input = "0123456789".repeat(50); // 500 chars, deterministic
    const maxChars = 120;
    const overlapChars = 20;

    const chunks = chunkText(input, { maxChars, overlapChars, minChunkChars: 10, separators: [] });
    expect(chunks.length).toBeGreaterThan(1);

    const c0 = chunks[0]!;
    const c1 = chunks[1]!;

    const expectedOverlap = input.slice(c0.charEnd - overlapChars, c0.charEnd);
    expect(c1.content.startsWith(expectedOverlap)).toBe(true);
  });

  it("has no empty chunks and sequential chunkIndex", () => {
    const input = "Hello world.\n\nThis is a test.";
    const chunks = chunkText(input, { maxChars: 10, overlapChars: 0, minChunkChars: 1 });

    expect(chunks.length).toBeGreaterThan(0);
    for (let i = 0; i < chunks.length; i++) {
      expect(chunks[i]!.chunkIndex).toBe(i);
      expect(chunks[i]!.content.length).toBeGreaterThan(0);
    }
  });
});
