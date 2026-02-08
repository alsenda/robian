import { normalizeAndValidateCandidateUrl } from '../../security/urlFilters.js'

// A realistic User-Agent reduces trivial bot blocks without changing architecture.
const REALISTIC_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36'

export async function searchWebBrave({ query, count = 5, timeoutMs = 12_000 }) {
  const apiKey = process.env.BRAVE_SEARCH_API_KEY
  if (!apiKey) {
    // Soft-fail so the model can proceed without search.
    return { ok: false, results: [], error: { message: 'Search is not configured on this server' } }
  }

  // Over-fetch slightly so filtering still returns usable results.
  const requested = Math.max(1, Math.min(10, Number(count) || 5))
  const boundedCount = Math.max(requested, Math.min(10, requested * 2))

  const url = new URL('https://api.search.brave.com/res/v1/web/search')
  url.searchParams.set('q', query)
  url.searchParams.set('count', String(boundedCount))

  const abortController = new AbortController()
  const timeout = setTimeout(() => abortController.abort(), timeoutMs)
  try {
    const response = await fetch(url.toString(), {
      method: 'GET',
      headers: {
        Accept: 'application/json',
        'X-Subscription-Token': apiKey,
        'User-Agent': REALISTIC_UA,
      },
      signal: abortController.signal,
    })

    if (!response.ok) {
      // Don’t leak raw provider details into the tool response.
      return {
        ok: false,
        results: [],
        error: { message: `Search provider error (HTTP ${response.status})` },
      }
    }

    const data = await response.json()
    const rawResults = data?.web?.results
    if (!Array.isArray(rawResults)) return []

    const results = rawResults
      .map((r) => {
        const title = typeof r?.title === 'string' ? r.title.trim() : ''
        const urlText = typeof r?.url === 'string' ? r.url.trim() : ''
        const snippet =
          typeof r?.description === 'string'
            ? r.description.trim()
            : typeof r?.snippet === 'string'
              ? r.snippet.trim()
              : ''

        // Normalize + filter so search_web returns URLs that are likely fetchable.
        const normalizedUrl = normalizeAndValidateCandidateUrl(urlText)
        return { title, url: normalizedUrl || '', snippet }
      })
      .filter((r) => r.title && r.url)

    // De-dupe while keeping ordering.
    const seen = new Set()
    const deduped = []
    for (const r of results) {
      if (seen.has(r.url)) continue
      seen.add(r.url)
      deduped.push(r)
      if (deduped.length >= requested) break
    }

    return { ok: true, results: deduped }
  } finally {
    clearTimeout(timeout)
  }
}
