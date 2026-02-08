export type PdfPageText = { pageNumber: number; text: string }
export type PdfExtractResult = {
  text: string
  pages: PdfPageText[]
  isLikelyScanned: boolean
}

type PdfJsModule = {
  getDocument: (src: unknown) => { promise: Promise<{ numPages: number; getPage: (n: number) => Promise<unknown>; destroy?: () => void }>; destroy?: () => void }
}

type PdfJsTextItem = {
  str?: string
  hasEOL?: boolean
}

function shimPdfJsGlobalsForNode(): void {
  // pdfjs-dist's Node utilities attempt to assign `globalThis.navigator`.
  // In Node 20+/22, `navigator` may exist as a read-only getter.
  const g = globalThis as unknown as Record<string, unknown>
  try {
    const desc = Object.getOwnPropertyDescriptor(globalThis, 'navigator')
    if (desc && !desc.writable && !desc.set) {
      // If configurable, remove it so pdf.js can attach its own.
      if (desc.configurable) {
        try {
          // eslint-disable-next-line @typescript-eslint/no-dynamic-delete
          delete (globalThis as unknown as { navigator?: unknown }).navigator
        } catch {
          // ignore
        }
      }

      // If it still exists and is read-only, redefine with a setter to avoid TypeError on assignment.
      const desc2 = Object.getOwnPropertyDescriptor(globalThis, 'navigator')
      if (desc2 && !desc2.writable && !desc2.set && desc2.configurable) {
        let value: unknown = desc2.get ? desc2.get.call(globalThis) : undefined
        Object.defineProperty(globalThis, 'navigator', {
          configurable: true,
          enumerable: true,
          get() {
            return value
          },
          set(v: unknown) {
            value = v
          },
        })
      }
    }

    // If there is no navigator, provide a minimal one.
    if (!Object.getOwnPropertyDescriptor(globalThis, 'navigator')) {
      Object.defineProperty(globalThis, 'navigator', {
        configurable: true,
        enumerable: true,
        writable: true,
        value: {},
      })
    }
  } catch {
    // ignore
  }

  // pdf.js uses this for some environment checks.
  try {
    if (g.window === undefined) g.window = undefined
  } catch {
    // ignore
  }

  // pdfjs-dist's legacy build may reference some DOM globals at import time.
  // For text extraction we don't need full implementations; we just need
  // them to exist so module evaluation doesn't throw.
  try {
    const gg = globalThis as unknown as Record<string, unknown>

    if (typeof gg.DOMMatrix !== 'function') {
      class DOMMatrixShim {
        a = 1
        b = 0
        c = 0
        d = 1
        e = 0
        f = 0

        constructor(init?: unknown) {
          if (Array.isArray(init) && init.length >= 6) {
            this.a = Number(init[0])
            this.b = Number(init[1])
            this.c = Number(init[2])
            this.d = Number(init[3])
            this.e = Number(init[4])
            this.f = Number(init[5])
          } else if (init && typeof init === 'object') {
            const o = init as Partial<DOMMatrixShim>
            if (typeof o.a === 'number') this.a = o.a
            if (typeof o.b === 'number') this.b = o.b
            if (typeof o.c === 'number') this.c = o.c
            if (typeof o.d === 'number') this.d = o.d
            if (typeof o.e === 'number') this.e = o.e
            if (typeof o.f === 'number') this.f = o.f
          }
        }

        toFloat64Array(): Float64Array {
          return new Float64Array([this.a, this.b, this.c, this.d, this.e, this.f])
        }
      }

      gg.DOMMatrix = DOMMatrixShim
    }

    if (typeof gg.Path2D !== 'function') {
      gg.Path2D = class Path2DShim {
        // no-op
      }
    }

    if (typeof gg.ImageData !== 'function') {
      gg.ImageData = class ImageDataShim {
        // no-op
      }
    }
  } catch {
    // ignore
  }
}

function readNumberEnv(name: string, fallback: number): number {
  const raw = process.env[name]
  const n = raw ? Number(raw) : Number.NaN
  return Number.isFinite(n) ? n : fallback
}

function nonWhitespaceChars(text: string): number {
  return text.replace(/\s+/g, '').length
}

function normalizePdfText(input: string): string {
  // Keep line breaks mostly intact; do not do aggressive cleanup.
  let s = String(input || '')

  // Normalize newlines
  s = s.replace(/\r\n/g, '\n').replace(/\r/g, '\n')

  // Remove null chars (sometimes appear from broken extraction)
  s = s.replace(/\u0000+/g, '')

  // Collapse weird horizontal whitespace runs, keep newlines
  s = s.replace(/[\t\f\v ]{2,}/g, ' ')

  // Avoid giant blank blocks, but preserve paragraph separation
  s = s.replace(/\n{3,}/g, '\n\n')

  return s
}

function buildPageTextFromTextContentItems(items: unknown[]): string {
  let out = ''
  for (const item of items) {
    const maybe = item as PdfJsTextItem
    if (typeof maybe?.str !== 'string') continue

    const str = maybe.str
    if (!str) {
      if (maybe.hasEOL) out += '\n'
      continue
    }

    out += str

    if (maybe.hasEOL) {
      out += '\n'
    } else {
      // Pdf.js tends to omit spaces between fragments.
      // Add a single space separator; later normalization collapses runs.
      out += ' '
    }
  }
  return out
}

function classifyLikelyScanned(pages: PdfPageText[]): boolean {
  // Defaults are intentionally low so that short, machine-text PDFs (e.g. 1-2 pages)
  // are not incorrectly treated as scanned. Use env vars to tune.
  const minTotal = Math.max(0, Math.floor(readNumberEnv('PDF_MIN_TOTAL_TEXT_CHARS', 10)))
  const minPage = Math.max(0, Math.floor(readNumberEnv('PDF_MIN_PAGE_TEXT_CHARS', 3)))
  const emptyRatio = Math.min(1, Math.max(0, readNumberEnv('PDF_EMPTY_PAGE_RATIO', 0.6)))

  const totalNonWs = pages.reduce((acc, p) => acc + nonWhitespaceChars(p.text), 0)
  if (totalNonWs < minTotal) return true

  if (pages.length === 0) return true

  const nearEmptyPages = pages.reduce((acc, p) => {
    return acc + (nonWhitespaceChars(p.text) < minPage ? 1 : 0)
  }, 0)

  return nearEmptyPages / pages.length >= emptyRatio
}

function toHelpfulPdfErrorMessage(error: unknown): { kind: 'invalid_pdf' | 'encrypted_pdf' | 'parse_failed'; message: string } {
  const e = error as { name?: string; message?: string } | null
  const name = String(e?.name || '')
  const msg = String(e?.message || '')

  if (/PasswordException/i.test(name) || /password/i.test(msg) || /encrypted/i.test(msg)) {
    return {
      kind: 'encrypted_pdf',
      message: 'PDF is encrypted or password-protected and cannot be processed.',
    }
  }

  if (/InvalidPDFException/i.test(name) || /invalid pdf/i.test(msg) || /malformed pdf/i.test(msg)) {
    return { kind: 'invalid_pdf', message: 'Invalid or corrupted PDF file.' }
  }

  return { kind: 'parse_failed', message: 'Failed to parse PDF.' }
}

export async function extractTextFromPdf(input: Buffer): Promise<PdfExtractResult> {
  if (!Buffer.isBuffer(input)) {
    throw new TypeError('extractTextFromPdf expects a Buffer')
  }

  shimPdfJsGlobalsForNode()

  // Dynamic import avoids bundler/runtime edge cases in NodeNext ESM.
  const pdfjs = (await import('pdfjs-dist/legacy/build/pdf.mjs')) as unknown as PdfJsModule

  const data = new Uint8Array(input.buffer, input.byteOffset, input.byteLength)

  const loadingTask = pdfjs.getDocument({
    data,
    disableWorker: true,
    stopAtErrors: false,
  })

  let doc: { numPages: number; getPage: (n: number) => Promise<unknown>; destroy?: () => void } | null = null
  try {
    doc = await loadingTask.promise

    const pages: PdfPageText[] = []

    for (let pageNumber = 1; pageNumber <= doc.numPages; pageNumber++) {
      const page = (await doc.getPage(pageNumber)) as {
        getTextContent: () => Promise<{ items: unknown[] }>
      }

      const textContent = await page.getTextContent()
      const raw = buildPageTextFromTextContentItems(textContent.items)
      const normalized = normalizePdfText(raw).trim()

      pages.push({ pageNumber, text: normalized })
    }

    let fullText = ''
    for (const page of pages) {
      // Stable page boundary markers for every page.
      if (fullText) fullText += '\n\n'
      fullText += `----- page ${page.pageNumber} -----\n\n${page.text}`
    }

    return {
      text: fullText,
      pages,
      isLikelyScanned: classifyLikelyScanned(pages),
    }
  } catch (error: unknown) {
    const helpful = toHelpfulPdfErrorMessage(error)
    const err = new Error(helpful.message, { cause: error })
    ;(err as { kind?: string }).kind = helpful.kind
    throw err
  } finally {
    try {
      doc?.destroy?.()
    } catch {
      // ignore
    }

    try {
      loadingTask.destroy?.()
    } catch {
      // ignore
    }
  }
}
