import { describe, expect, it } from "vitest";

import { normalizeText } from "../../../src/server/rag/text/normalize.ts";

describe("normalizeText", () => {
  it("removes nulls", () => {
    expect(normalizeText("a\u0000b")).toBe("ab");
  });

  it("converts \\r\\n to \\n", () => {
    expect(normalizeText("a\r\nb\r\n\r\nc")).toBe("a\nb\n\nc");
  });

  it("fixes line-break hyphenation in safe cases", () => {
    expect(normalizeText("exam-\nple")).toBe("example");
  });

  it("does not change real hyphenated words", () => {
    expect(normalizeText("state-of-the-art")).toBe("state-of-the-art");
  });
});
