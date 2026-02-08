import { afterEach, describe, expect, it, vi } from "vitest";

import { EMBEDDING_DIM } from "../../../src/server/db/constants.ts";
import { embedQuery, embedTexts } from "../../../src/server/rag/embeddings/ollama.ts";

function makeVec(dim: number, hotIndex = 0): number[] {
  const v = new Array<number>(dim).fill(0);
  if (dim > 0) { v[Math.max(0, Math.min(dim - 1, hotIndex))] = 1; }
  return v;
}

describe("ollama embeddings adapter", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("embedTexts returns embeddings and enforces dimensions", async () => {
    const fetchMock = vi.fn(async () => {
      return {
        ok: true,
        status: 200,
        async json() {
          return { embeddings: [makeVec(EMBEDDING_DIM, 1), makeVec(EMBEDDING_DIM, 2)] };
        },
      } as any;
    });

    vi.stubGlobal("fetch", fetchMock);

    const out = await embedTexts(["hello", "world"], { baseUrl: "http://127.0.0.1:11434", model: "nomic-embed-text" });
    expect(out).toHaveLength(2);
    expect(out[0]).toHaveLength(EMBEDDING_DIM);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("embedQuery returns a single vector", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        ({
          ok: true,
          status: 200,
          async json() {
            return { embeddings: [makeVec(EMBEDDING_DIM, 3)] };
          },
        }) as any,
      ),
    );

    const vec = await embedQuery("q");
    expect(vec).toHaveLength(EMBEDDING_DIM);
  });

  it("throws on empty inputs", async () => {
    await expect(embedTexts([] as any)).rejects.toThrow("non-empty");
    await expect(embedQuery("")).rejects.toThrow("empty");
  });

  it("throws on dimension mismatch vs EMBEDDING_DIM", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        ({
          ok: true,
          status: 200,
          async json() {
            return { embeddings: [[0, 1, 2]] };
          },
        }) as any,
      ),
    );

    await expect(embedTexts(["x"])).rejects.toThrow("Embedding dim mismatch");
  });
});
