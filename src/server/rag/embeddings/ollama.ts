import { EMBEDDING_DIM } from '../../db/constants.ts'

export type EmbedOptions = { model?: string; baseUrl?: string; timeoutMs?: number }

function sanitizeBaseUrl(url: string): string {
  return String(url || '').trim().replace(/\/+$/, '')
}

function resolveOptions(opts?: EmbedOptions): { model: string; baseUrl: string; timeoutMs: number } {
  const baseUrl = sanitizeBaseUrl(opts?.baseUrl ?? process.env.OLLAMA_BASE_URL ?? 'http://127.0.0.1:11434')
  const model = String(opts?.model ?? process.env.OLLAMA_EMBED_MODEL ?? 'nomic-embed-text').trim()
  const timeoutMsRaw = opts?.timeoutMs ?? 12_000
  const timeoutMs = Number.isFinite(timeoutMsRaw) && (timeoutMsRaw as number) > 0 ? Math.floor(timeoutMsRaw as number) : 12_000

  return { model, baseUrl, timeoutMs }
}

function isFiniteNumberArray(value: unknown): value is number[] {
  return Array.isArray(value) && value.every((v) => typeof v === 'number' && Number.isFinite(v))
}

function toOneLine(input: string): string {
  return String(input || '')
    .replace(/[\r\n\t]+/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim()
}

function describeResponseBody(body: unknown): string {
  try {
    return toOneLine(JSON.stringify(body))
  } catch {
    return ''
  }
}

function assertValidEmbeddings(vectors: number[][]): void {
  if (!Array.isArray(vectors) || vectors.length === 0) {
    throw new Error('Ollama embeddings response is empty')
  }

  const dim = vectors[0]?.length ?? 0
  if (!Number.isFinite(dim) || dim <= 0) {
    throw new Error('Ollama embeddings returned an invalid vector')
  }

  for (let i = 0; i < vectors.length; i++) {
    const vec = vectors[i]
    if (!isFiniteNumberArray(vec) || vec.length === 0) {
      throw new Error(`Ollama embeddings returned a non-numeric vector at index ${i}`)
    }

    if (vec.length !== dim) {
      throw new Error(`Ollama embeddings returned inconsistent dimensions (got ${vec.length} vs ${dim})`)
    }
  }

  if (dim !== EMBEDDING_DIM) {
    throw new Error(
      `Embedding dim mismatch: expected ${EMBEDDING_DIM}, got ${dim}. ` +
        `Check OLLAMA_EMBED_MODEL (currently "${process.env.OLLAMA_EMBED_MODEL ?? 'nomic-embed-text'}") and your sqlite-vec schema.`,
    )
  }
}

export async function embedTexts(texts: string[], opts?: EmbedOptions): Promise<number[][]> {
  if (!Array.isArray(texts) || texts.length === 0) {
    throw new Error('embedTexts requires a non-empty array')
  }

  const prepared = texts.map((t, i) => {
    const s = String(t ?? '').trim()
    if (!s) throw new Error(`embedTexts input at index ${i} is empty`)
    return s
  })

  const { baseUrl, model, timeoutMs } = resolveOptions(opts)
  if (!baseUrl) throw new Error('OLLAMA_BASE_URL is empty')
  if (!model) throw new Error('OLLAMA_EMBED_MODEL is empty')

  const abortController = new AbortController()
  const timeout = setTimeout(() => abortController.abort(), timeoutMs)

  try {
    const resp = await fetch(`${baseUrl}/api/embed`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model, input: prepared }),
      signal: abortController.signal,
    })

    const json: unknown = await resp
      .json()
      .catch(() => null)

    if (!resp.ok) {
      const suffix = json ? ` body=${describeResponseBody(json)}` : ''
      throw new Error(`Ollama embeddings request failed (HTTP ${resp.status}) for model "${model}".${suffix}`)
    }

    const embeddings =
      json && typeof json === 'object'
        ? (json as { embeddings?: unknown }).embeddings
        : undefined

    if (!Array.isArray(embeddings)) {
      throw new Error(
        `Ollama /api/embed did not return an embeddings array for model "${model}". ` +
          `Verify Ollama is running and the model supports embeddings.`,
      )
    }

    const vectors: number[][] = []
    for (let i = 0; i < embeddings.length; i++) {
      const v = embeddings[i]
      if (!Array.isArray(v) || !isFiniteNumberArray(v)) {
        throw new Error(`Ollama embeddings response at index ${i} is not a numeric vector`)
      }
      vectors.push(v)
    }

    if (vectors.length !== prepared.length) {
      throw new Error(`Ollama embeddings count mismatch: expected ${prepared.length}, got ${vectors.length}`)
    }

    assertValidEmbeddings(vectors)

    return vectors
  } catch (error: unknown) {
    if (abortController.signal.aborted) {
      throw new Error(`Ollama embeddings request timed out after ${timeoutMs}ms (model "${model}")`)
    }

    if (error instanceof Error) throw error
    throw new Error(`Ollama embeddings failed: ${String(error ?? 'unknown error')}`)
  } finally {
    clearTimeout(timeout)
  }
}

export async function embedQuery(text: string, opts?: EmbedOptions): Promise<number[]> {
  const [vec] = await embedTexts([text], opts)
  if (!vec) throw new Error('Ollama embeddings returned no vector for query')
  return vec
}
