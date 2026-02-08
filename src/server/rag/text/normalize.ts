export type NormalizeOptions = {
  collapseWhitespace?: boolean // default true
  fixHyphenation?: boolean // default true (only safe cases)
  removeNulls?: boolean // default true
}

function withDefaults(opts?: NormalizeOptions): Required<NormalizeOptions> {
  return {
    collapseWhitespace: opts?.collapseWhitespace ?? true,
    fixHyphenation: opts?.fixHyphenation ?? true,
    removeNulls: opts?.removeNulls ?? true,
  }
}

function removeNullChars(input: string): string {
  // Keep this intentionally conservative: remove only obvious null bytes.
  return input.replace(/\u0000+/g, '')
}

function normalizeNewlines(input: string): string {
  // Windows CRLF -> LF, legacy CR -> LF
  return input.replace(/\r\n/g, '\n').replace(/\r/g, '\n')
}

function fixLineBreakHyphenation(input: string): string {
  // Fix ONLY clear line-break hyphenation cases:
  // - hyphen immediately follows letters
  // - newline immediately after hyphen
  // - next token starts immediately (no indentation)
  // - next token is at least 3 letters (avoid joining e.g. "state-\nof")
  // This is a heuristic; keep deterministic and conservative.
  return input.replace(/(\p{L}{2,})-\n(\p{L}{3,})/gu, '$1$2')
}

function collapseHorizontalWhitespacePreservingParagraphs(input: string): string {
  // Collapse runs of spaces/tabs, but preserve paragraph breaks (\n\n).
  // Also strip spaces around newlines to prevent " \n" artifacts.
  let s = input
  s = s.replace(/[\t ]+/g, ' ')
  s = s.replace(/ *\n */g, '\n')
  return s
}

export function normalizeText(input: string, opts?: NormalizeOptions): string {
  const options = withDefaults(opts)

  let s = String(input ?? '')

  if (options.removeNulls) {
    s = removeNullChars(s)
  }

  s = normalizeNewlines(s)

  if (options.fixHyphenation) {
    s = fixLineBreakHyphenation(s)
  }

  if (options.collapseWhitespace) {
    s = collapseHorizontalWhitespacePreservingParagraphs(s)
  }

  return s
}
