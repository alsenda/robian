import { normalizeAndValidateCandidateUrl } from "../../security/urlFilters.ts";

// A realistic User-Agent reduces trivial bot blocks without changing architecture.
const REALISTIC_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36";

function decodeHtmlEntities(text: string): string {
  const input = String(text || "");
  if (!input.includes("&")) { return input; }
  return input
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#(\d+);/g, (_, code) => {
      const n = Number(code);
      if (!Number.isFinite(n)) { return _; }
      try {
        return String.fromCodePoint(n);
      } catch {
        return _;
      }
    })
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => {
      const n = Number.parseInt(hex, 16);
      if (!Number.isFinite(n)) { return _; }
      try {
        return String.fromCodePoint(n);
      } catch {
        return _;
      }
    });
}

function stripTags(html: string): string {
  return String(html || "")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function resolveDuckDuckGoHref(href: string): string {
  try {
    const url = new URL(String(href || ""), "https://duckduckgo.com");
    const host = url.hostname.toLowerCase();
    if (host.endsWith("duckduckgo.com") && url.pathname === "/l/") {
      const uddg = url.searchParams.get("uddg");
      if (uddg) { return decodeURIComponent(uddg); }
    }
    return url.toString();
  } catch {
    return String(href || "").trim();
  }
}

function normalizeProviderName(name: unknown): string {
  const v = String(name || "").trim().toLowerCase();
  if (!v) { return "duckduckgo"; }
  if (v === "ddg" || v === "duckduckgo" || v === "duck-duck-go") { return "duckduckgo"; }
  if (v === "brave") { return "brave"; }
  return v;
}

export function getWebSearchProvider(): string {
  return normalizeProviderName(process.env.WEB_SEARCH_PROVIDER);
}

export interface WebSearchResult { title: string; url: string; snippet: string; }

export async function searchWeb({
  query,
  count = 5,
  timeoutMs = 12_000,
}: {
  query: string
  count?: number
  timeoutMs?: number,
}): Promise<WebSearchResult[] | { ok: boolean; results: WebSearchResult[]; error?: { message: string } }> {
  const provider = getWebSearchProvider();
  if (provider === "brave") { return searchWebBrave({ query, count, timeoutMs }); }
  // Default: DuckDuckGo HTML (no API key required).
  return searchWebDuckDuckGo({ query, count, timeoutMs });
}

export async function searchWebDuckDuckGo({
  query,
  count = 5,
  timeoutMs = 12_000,
}: {
  query: string
  count?: number
  timeoutMs?: number,
}): Promise<{ ok: boolean; results: WebSearchResult[]; error?: { message: string } }> {
  const requested = Math.max(1, Math.min(10, Number(count) || 5));

  const url = new URL("https://html.duckduckgo.com/html/");
  url.searchParams.set("q", String(query || ""));

  const abortController = new AbortController();
  const timeout = setTimeout(() => abortController.abort(), timeoutMs);
  try {
    const response = await fetch(url.toString(), {
      method: "GET",
      headers: {
        "Accept": "text/html,application/xhtml+xml;q=0.9,*/*;q=0.1",
        "Accept-Language": "en-US,en;q=0.9",
        "User-Agent": REALISTIC_UA,
      },
      signal: abortController.signal,
    });

    if (!response.ok) {
      return {
        ok: false,
        results: [],
        error: { message: `Search provider error (HTTP ${response.status})` },
      };
    }

    const html = await response.text();
    const results: WebSearchResult[] = [];
    const seen = new Set<string>();

    // DuckDuckGo HTML results are fairly stable: anchors with class result__a.
    const anchorRe =
      /<a\s+[^>]*class=(?:"[^"]*\bresult__a\b[^"]*"|'[^']*\bresult__a\b[^']*')[^>]*href=(?:"([^"]+)"|'([^']+)')[^>]*>([\s\S]*?)<\/a>/gi;
    let match: RegExpExecArray | null;
    while ((match = anchorRe.exec(html))) {
      const href = match[1] || match[2] || "";
      const titleHtml = match[3] || "";
      const title = decodeHtmlEntities(stripTags(titleHtml));

      // Best-effort snippet: search near this result.
      const windowText = html.slice(match.index, Math.min(html.length, match.index + 2000));
      const snippetMatch =
        /<(?:a|div)\s+[^>]*class=(?:"[^"]*\bresult__snippet\b[^"]*"|'[^']*\bresult__snippet\b[^']*')[^>]*>([\s\S]*?)<\/(?:a|div)>/i.exec(
          windowText,
        );
      const snippet = decodeHtmlEntities(stripTags(snippetMatch?.[1] || ""));

      const resolvedHref = resolveDuckDuckGoHref(href);
      const normalizedUrl = normalizeAndValidateCandidateUrl(resolvedHref);
      if (!title || !normalizedUrl) { continue; }
      if (seen.has(normalizedUrl)) { continue; }
      seen.add(normalizedUrl);
      results.push({ title, url: normalizedUrl, snippet });
      if (results.length >= requested) { break; }
    }

    return { ok: true, results };
  } catch {
    if (abortController.signal.aborted) {
      return { ok: false, results: [], error: { message: "Search request timed out" } };
    }
    return { ok: false, results: [], error: { message: "Search network error" } };
  } finally {
    clearTimeout(timeout);
  }
}

export async function searchWebBrave({
  query,
  count = 5,
  timeoutMs = 12_000,
}: {
  query: string
  count?: number
  timeoutMs?: number,
}): Promise<{ ok: boolean; results: WebSearchResult[]; error?: { message: string } }> {
  const apiKey = process.env.BRAVE_SEARCH_API_KEY;
  if (!apiKey) {
    // Soft-fail so the model can proceed without search.
    return { ok: false, results: [], error: { message: "Search is not configured on this server" } };
  }

  // Over-fetch slightly so filtering still returns usable results.
  const requested = Math.max(1, Math.min(10, Number(count) || 5));
  const boundedCount = Math.max(requested, Math.min(10, requested * 2));

  const url = new URL("https://api.search.brave.com/res/v1/web/search");
  url.searchParams.set("q", query);
  url.searchParams.set("count", String(boundedCount));

  const abortController = new AbortController();
  const timeout = setTimeout(() => abortController.abort(), timeoutMs);
  try {
    const response = await fetch(url.toString(), {
      method: "GET",
      headers: {
        "Accept": "application/json",
        "X-Subscription-Token": apiKey,
        "User-Agent": REALISTIC_UA,
      },
      signal: abortController.signal,
    });

    if (!response.ok) {
      // Don’t leak raw provider details into the tool response.
      return {
        ok: false,
        results: [],
        error: { message: `Search provider error (HTTP ${response.status})` },
      };
    }

    const data: any = await response.json();
    const rawResults = data?.web?.results;
    if (!Array.isArray(rawResults)) { return { ok: true, results: [] }; }

    const results = (rawResults as any[])
      .map((r) => {
        const title = typeof r?.title === "string" ? r.title.trim() : "";
        const urlText = typeof r?.url === "string" ? r.url.trim() : "";
        const snippet =
          typeof r?.description === "string"
            ? r.description.trim()
            : typeof r?.snippet === "string"
              ? r.snippet.trim()
              : "";

        // Normalize + filter so search_web returns URLs that are likely fetchable.
        const normalizedUrl = normalizeAndValidateCandidateUrl(urlText);
        return { title, url: normalizedUrl || "", snippet };
      })
      .filter((r) => r.title && r.url);

    // De-dupe while keeping ordering.
    const seen = new Set<string>();
    const deduped: WebSearchResult[] = [];
    for (const r of results) {
      if (seen.has(r.url)) { continue; }
      seen.add(r.url);
      deduped.push(r);
      if (deduped.length >= requested) { break; }
    }

    return { ok: true, results: deduped };
  } finally {
    clearTimeout(timeout);
  }
}
