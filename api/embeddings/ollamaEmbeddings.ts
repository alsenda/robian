import type { EmbeddingVector, EmbeddingsError, EmbeddingsService } from './types.ts'

export type EmbeddingsHealth =
  | { ok: true }
  | { ok: false; error: EmbeddingsError }

function asEmbeddingsError(error: unknown): EmbeddingsError {
  if (error && typeof error === 'object') {
    const kind = (error as { kind?: unknown }).kind
    const message = (error as { message?: unknown }).message
    if (typeof kind === 'string' && typeof message === 'string') {
      return { kind, message }
    }
  }

  if (error instanceof Error) {
    return { kind: 'unknown', message: error.message }
  }

  return { kind: 'unknown', message: 'Unknown embeddings error' }
}

function sanitizeBaseUrl(url: string): string {
  return String(url || '').trim().replace(/\/+$/, '')
}

function isNonEmptyNumberArray(value: unknown): value is number[] {
  if (!Array.isArray(value) || value.length === 0) return false
  return value.every((v) => typeof v === 'number' && Number.isFinite(v))
}

export function truncateEmbeddingInput(input: string, maxChars: number): string {
  const text = String(input ?? '')
  if (!Number.isFinite(maxChars) || maxChars <= 0) return text
  if (text.length <= maxChars) return text

  const marker = `\n[TRUNCATED to ${Math.floor(maxChars)} chars]`
  const keep = Math.max(0, maxChars - marker.length)
  return text.slice(0, keep) + marker
}

export function createOllamaEmbeddingsService({
  ollamaUrl,
  model,
  timeoutMs = 12_000,
}: {
  ollamaUrl: string
  model: string
  timeoutMs?: number
}): EmbeddingsService {
  const baseUrl = sanitizeBaseUrl(ollamaUrl)
  const configuredModel = String(model || '').trim()

  return {
    async embedText(input: string): Promise<EmbeddingVector> {
      const trimmed = String(input ?? '').trim()
      if (!trimmed) {
        throw {
          kind: 'invalid_input',
          message: 'Embedding input is empty',
        } satisfies EmbeddingsError
      }

      const abortController = new AbortController()
      const timeout = setTimeout(() => abortController.abort(), timeoutMs)
      try {
        const resp = await fetch(`${baseUrl}/api/embed`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ model: configuredModel, input: trimmed }),
          signal: abortController.signal,
        })

        if (!resp.ok) {
          throw {
            kind: 'http_error',
            message: `Embeddings request failed (HTTP ${resp.status}) for model "${configuredModel}"`,
          } satisfies EmbeddingsError
        }

        const json: unknown = await resp.json().catch(() => null)
        const embeddings =
          json && typeof json === 'object'
            ? (json as { embeddings?: unknown }).embeddings
            : undefined

        if (!Array.isArray(embeddings)) {
          throw {
            kind: 'unsupported_model',
            message:
              `Ollama embed response for model "${configuredModel}" did not include embeddings. ` +
              'If this model does not support /api/embed, set OLLAMA_EMBED_MODEL to a dedicated embedding model later.',
          } satisfies EmbeddingsError
        }

        const first = embeddings[0]
        if (!Array.isArray(first) || !isNonEmptyNumberArray(first)) {
          throw {
            kind: 'invalid_response',
            message: `Invalid embeddings payload for model "${configuredModel}"`,
          } satisfies EmbeddingsError
        }

        return first
      } catch (error: unknown) {
        if (abortController.signal.aborted) {
          throw {
            kind: 'timeout',
            message: `Embeddings request timed out for model "${configuredModel}"`,
          } satisfies EmbeddingsError
        }
        throw asEmbeddingsError(error)
      } finally {
        clearTimeout(timeout)
      }
    },
  }
}

export async function checkEmbeddingsHealth(service: EmbeddingsService): Promise<EmbeddingsHealth> {
  try {
    const vector = await service.embedText('health check')
    if (!isNonEmptyNumberArray(vector)) {
      return { ok: false, error: { kind: 'invalid_response', message: 'Embeddings vector is invalid' } }
    }
    return { ok: true }
  } catch (error: unknown) {
    return { ok: false, error: asEmbeddingsError(error) }
  }
}
