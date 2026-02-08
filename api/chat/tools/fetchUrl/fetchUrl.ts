import { assertPublicHostname } from '../../security/ssrf.ts'
import { stripHtmlToText } from '../../utils/html.ts'

// A realistic User-Agent reduces trivial bot blocks without changing architecture.
const REALISTIC_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36'

type FetchTextOk = {
  ok: true
  url: string
  status: number
  contentType: string
  text: string
  truncated: boolean
}

type FetchTextErr = {
  ok: false
  url: string
  status: number
  contentType: string
  text: string
  truncated: boolean
  error: { kind?: string; message: string }
}

export async function fetchTextFromUrl({
  url,
  timeoutMs = 12_000,
  maxBytes = 1_000_000,
}: {
  url: string
  timeoutMs?: number
  maxBytes?: number
}): Promise<FetchTextOk | FetchTextErr> {
  // Returns structured results so fetch_url can treat failures as soft.
  let current = new URL(url)
  if (current.protocol !== 'http:' && current.protocol !== 'https:') {
    return {
      ok: false,
      url: String(url),
      status: 0,
      contentType: '',
      text: '',
      truncated: false,
      error: { kind: 'invalid_url', message: 'Only http/https URLs are allowed' },
    }
  }

  const abortController = new AbortController()
  const timeout = setTimeout(() => abortController.abort(), timeoutMs)
  try {
    // Follow redirects manually so SSRF protections are applied to every hop.
    let response: Response | undefined
    const maxRedirects = 5
    for (let redirects = 0; redirects <= maxRedirects; redirects++) {
      await assertPublicHostname(current.hostname)
      try {
        response = await fetch(current.toString(), {
          method: 'GET',
          redirect: 'manual',
          headers: {
            'User-Agent': REALISTIC_UA,
            'Accept-Language': 'en-US,en;q=0.9',
            Accept: 'text/html, text/plain;q=0.9, application/json;q=0.5, */*;q=0.1',
          },
          signal: abortController.signal,
        })
      } catch (error) {
        if (abortController.signal.aborted) throw error
        return {
          ok: false,
          url: current.toString(),
          status: 0,
          contentType: '',
          text: '',
          truncated: false,
          error: { kind: 'network', message: 'Network error while fetching URL' },
        }
      }

      const status = Number(response?.status) || 0
      if ([301, 302, 303, 307, 308].includes(status)) {
        const location = response.headers?.get?.('location') || ''
        if (!location) break
        if (redirects >= maxRedirects) {
          return {
            ok: false,
            url: current.toString(),
            status,
            contentType: response.headers.get('content-type') || '',
            text: '',
            truncated: false,
            error: { kind: 'redirect', message: 'Too many redirects while fetching URL' },
          }
        }
        try {
          current = new URL(location, current)
          if (current.protocol !== 'http:' && current.protocol !== 'https:') {
            return {
              ok: false,
              url: current.toString(),
              status,
              contentType: response.headers.get('content-type') || '',
              text: '',
              truncated: false,
              error: { kind: 'invalid_url', message: 'Redirected to a non-http(s) URL' },
            }
          }
          continue
        } catch {
          break
        }
      }
      break
    }

    if (!response) {
      return {
        ok: false,
        url: current.toString(),
        status: 0,
        contentType: '',
        text: '',
        truncated: false,
        error: { kind: 'network', message: 'No response while fetching URL' },
      }
    }

    const finalUrl = current.toString()
    const status = Number(response?.status) || 0
    const contentType = response?.headers?.get?.('content-type') || ''

    if ([301, 302, 303, 307, 308].includes(status)) {
      return {
        ok: false,
        url: finalUrl,
        status,
        contentType,
        text: '',
        truncated: false,
        error: { kind: 'redirect', message: 'Redirect response without a valid Location header' },
      }
    }

    // Treat common blocks / errors as soft failures (don’t throw).
    if (status >= 400) {
      const kind =
        status === 404
          ? 'not_found'
          : status === 403
            ? 'blocked'
            : status === 401
              ? 'blocked'
              : status === 429
                ? 'rate_limited'
                : 'http_error'
      return {
        ok: false,
        url: finalUrl,
        status,
        contentType,
        text: '',
        truncated: false,
        error: { kind, message: `HTTP ${status} while fetching URL` },
      }
    }

    const reader = response.body?.getReader?.()
    if (!reader) {
      return {
        ok: false,
        url: finalUrl,
        status,
        contentType,
        text: '',
        truncated: false,
        error: { kind: 'unreadable', message: 'Response body is not readable' },
      }
    }

    const chunks: Uint8Array[] = []
    let received = 0
    let truncated = false
    try {
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        if (!value) continue

        if (received + value.byteLength > maxBytes) {
          const remaining = Math.max(0, maxBytes - received)
          if (remaining > 0) {
            chunks.push(value.subarray(0, remaining))
            received += remaining
          }
          truncated = true
          // Stop reading further bytes: return partial content instead of throwing.
          try {
            await reader.cancel('maxBytes reached')
          } catch {
            // ignore
          }
          break
        }

        chunks.push(value)
        received += value.byteLength
      }
    } finally {
      try {
        reader.releaseLock()
      } catch {
        // ignore
      }
    }

    const all = new Uint8Array(received)
    let offset = 0
    for (const chunk of chunks) {
      all.set(chunk, offset)
      offset += chunk.byteLength
    }

    const decoded = new TextDecoder('utf-8', { fatal: false }).decode(all)
    const extracted = contentType.includes('text/html') ? stripHtmlToText(decoded) : decoded.trim()
    const text = truncated && extracted ? `${extracted}\n\n[Content truncated due to size limits]` : extracted

    return {
      ok: true,
      url: finalUrl,
      status,
      contentType,
      text,
      truncated,
    }
  } finally {
    clearTimeout(timeout)
  }
}
