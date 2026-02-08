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

function maybeTruncate(input: string, maxChars?: number): string {
  if (typeof maxChars !== 'number' || !Number.isFinite(maxChars) || maxChars <= 0) return input
  const cap = Math.floor(maxChars)
  if (input.length <= cap) return input
  return input.slice(0, cap) + '\n\n[TRUNCATED]'
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
    async embedText(input: string, maxChars?: number): Promise<EmbeddingVector> {
      const trimmed = String(input ?? '').trim()
      if (!trimmed) {
        throw {
          kind: 'invalid_input',
          message: 'Embedding input is empty',
        } satisfies EmbeddingsError
      }

      const prepared = maybeTruncate(trimmed, maxChars)

      const abortController = new AbortController()
      const timeout = setTimeout(() => abortController.abort(), timeoutMs)
      try {
        const resp = await fetch(`${baseUrl}/api/embed`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ model: configuredModel, input: prepared }),
          signal: abortController.signal,
        })

        if (!resp.ok) {
          throw {
            kind: 'network',
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
            message: `Embeddings failed for model "${configuredModel}". Verify OLLAMA_EMBED_MODEL supports /api/embed and that Ollama is up to date.`,
          } satisfies EmbeddingsError
        }

        const first = embeddings[0]
        if (!Array.isArray(first) || !isNonEmptyNumberArray(first)) {
          throw {
            kind: 'unsupported_model',
            message: `Embeddings failed for model "${configuredModel}". Verify OLLAMA_EMBED_MODEL supports /api/embed and returns numeric vectors.`,
          } satisfies EmbeddingsError
        }

        return first
      } catch (error: unknown) {
        if (abortController.signal.aborted) {
          throw {
            kind: 'network',
            message: `Embeddings request timed out for model "${configuredModel}"`,
          } satisfies EmbeddingsError
        }

        const normalized = asEmbeddingsError(error)
        if (
          normalized.kind === 'invalid_input' ||
          normalized.kind === 'unsupported_model' ||
          normalized.kind === 'network'
        ) {
          throw normalized
        }

        throw {
          kind: 'network',
          message: normalized.message,
        } satisfies EmbeddingsError
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
