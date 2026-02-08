import { describe, expect, it } from 'vitest'
import { PDFDocument, StandardFonts } from 'pdf-lib'

import { extractTextFromPdf } from '../../../src/server/rag/extract/pdf.ts'

async function makeTwoPagePdf(): Promise<Buffer> {
  const pdfDoc = await PDFDocument.create()
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica)

  const page1 = pdfDoc.addPage()
  page1.drawText('Hello PDF', { x: 50, y: 700, font, size: 18 })

  const page2 = pdfDoc.addPage()
  page2.drawText('Second page', { x: 50, y: 700, font, size: 18 })

  const bytes = await pdfDoc.save()
  return Buffer.from(bytes)
}

describe('extractTextFromPdf', () => {
  it('extracts per-page text and includes stable page markers', async () => {
    const buf = await makeTwoPagePdf()
    const result = await extractTextFromPdf(buf)

    expect(result.pages.length).toBe(2)

    expect(result.pages[0]?.text).toContain('Hello')
    expect(result.pages[0]?.text).toContain('PDF')

    expect(result.pages[1]?.text).toContain('Second')
    expect(result.pages[1]?.text).toContain('page')

    expect(result.text).toContain('----- page 1 -----')
    expect(result.text).toContain('----- page 2 -----')
    expect(result.text).toContain('Hello PDF')
    expect(result.text).toContain('Second page')

    expect(result.isLikelyScanned).toBe(false)
  })
})
