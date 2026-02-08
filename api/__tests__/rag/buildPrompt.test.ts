import { describe, it, expect } from 'vitest'

const { buildRagPrompt } = await import('../../../src/server/rag/prompt/buildPrompt.ts')

describe('buildRagPrompt', () => {
  it('includes numbered context snippets and source tags', () => {
    const prompt = buildRagPrompt({
      question: 'What is the policy?',
      chunks: [
        {
          chunkId: 'c1',
          documentId: 'd1',
          filename: 'a.pdf',
          pageStart: 12,
          pageEnd: 12,
          content: 'Policy text A.',
          score: 0.9,
        },
        {
          chunkId: 'c2',
          documentId: 'd2',
          filename: 'b.pdf',
          pageStart: 3,
          pageEnd: 4,
          content: 'Policy text B.',
          score: 0.8,
        },
      ],
    })

    expect(prompt).toContain('Context:')
    expect(prompt).toContain('1) [source: a.pdf p.12]')
    expect(prompt).toContain('2) [source: b.pdf p.3-4]')
    expect(prompt).toMatch(/Citations: Every sentence.*\[source: filename p\.12\]/)
  })

  it('instructs to say insufficient info when no chunks', () => {
    const prompt = buildRagPrompt({ question: 'Q', chunks: [] })
    expect(prompt).toContain('(no context snippets were retrieved)')
    expect(prompt.toLowerCase()).toContain('not contain enough information')
  })
})
