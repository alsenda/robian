import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { EventEmitter } from 'node:events'

let capturedSse = ''
let consumeDone: Promise<void> = Promise.resolve()
let pipeSpy: ReturnType<typeof vi.fn>

function createSseStream(dataEvents: string[]) {
  const encoder = new TextEncoder()
  return new ReadableStream({
    start(controller) {
      for (const event of dataEvents) {
        controller.enqueue(encoder.encode(`data: ${event}\n\n`))
      }
      controller.enqueue(encoder.encode('data: [DONE]\n\n'))
      controller.close()
    },
  })
}

function parseCapturedChunks(): any[] {
  const chunks: any[] = []
  const lines = String(capturedSse || '').split('\n')
  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed.startsWith('data:')) continue
    const payload = trimmed.slice('data:'.length).trim()
    if (!payload || payload === '[DONE]') continue
    try {
      chunks.push(JSON.parse(payload))
    } catch {
      // ignore
    }
  }
  return chunks
}

vi.mock('@tanstack/ai', async (importOriginal) => {
  const actual = await importOriginal<any>()
  return {
    ...actual,
    convertMessagesToModelMessages: vi.fn((messages: unknown) => messages),
    toServerSentEventsStream: (stream: any) => {
      const encoder = new TextEncoder()
      return new ReadableStream({
        async start(controller) {
          for await (const chunk of stream) {
            controller.enqueue(encoder.encode(`data: ${JSON.stringify(chunk)}\n\n`))
          }
          controller.close()
        },
      })
    },
  }
})

vi.mock('node:stream', () => {
  pipeSpy = vi.fn()
  return {
    Readable: {
      fromWeb: vi.fn((webStream: any) => {
        capturedSse = ''
        consumeDone = (async () => {
          if (!webStream || typeof webStream.getReader !== 'function') return
          const reader = webStream.getReader()
          const decoder = new TextDecoder()
          try {
            while (true) {
              const { done, value } = await reader.read()
              if (done) break
              capturedSse += decoder.decode(value, { stream: true })
            }
          } finally {
            try {
              reader.releaseLock()
            } catch {
              // ignore
            }
          }
        })()

        const nodeStream = {
          pipe: pipeSpy,
          on: vi.fn(() => nodeStream),
          destroy: vi.fn(),
        }
        return nodeStream
      }),
    },
  }
})

const { createHandleChat } = await import('../../chat/index.ts')

function createReqRes({ body }: { body?: unknown } = {}) {
  const req = new EventEmitter() as any
  req.body = body

  const headers = new Map<string, unknown>()
  const res = new EventEmitter() as any
  Object.assign(res, {
    statusCode: undefined as number | undefined,
    status(code: number) {
      this.statusCode = code
      return this
    },
    setHeader(key: string, value: unknown) {
      headers.set(key, value)
    },
    flushHeaders: vi.fn(),
    write: vi.fn(),
    end: vi.fn(),
    jsonPayload: undefined as unknown,
    json(payload: unknown) {
      this.jsonPayload = payload
      return this
    },
  })

  return { req, res, headers }
}

describe('handleChat autonomous RAG (behavioral)', () => {
  const originalEnv = process.env
  const originalFetch = globalThis.fetch

  beforeEach(() => {
    process.env = { ...originalEnv }
    delete process.env.RAG_AUTONUDGE
  })

  afterEach(() => {
    process.env = originalEnv
    globalThis.fetch = originalFetch
  })

  it('doc-related query triggers rag_search_uploads tool-call before answering', async () => {
    const rag = {
      upsertDocuments: async () => ({ ok: true, upserted: 0 }),
      deleteDocuments: async () => ({ ok: true, deleted: 0 }),
      query: vi.fn(async () => ({
        ok: true,
        query: 'payment terms',
        results: [
          {
            id: 'u1:0',
            chunkId: 'u1:0',
            documentId: 'u1',
            filename: 'contract.txt',
            pageStart: 1,
            pageEnd: 1,
            score: 0.9,
            source: 'upload',
            sourceId: 'u1',
            excerpt: 'Net 30.',
          },
        ],
      })),
    }

    const handleChat = createHandleChat({ ragService: rag as any })

    let call = 0
    globalThis.fetch = vi.fn(async () => {
      call++
      if (call === 1) {
        return {
          ok: true,
          status: 200,
          statusText: 'OK',
          body: createSseStream([
            JSON.stringify({
              model: 'robian:latest',
              choices: [
                {
                  delta: {
                    tool_calls: [
                      {
                        index: 0,
                        id: 'call-1',
                        function: {
                          name: 'rag_search_uploads',
                          arguments: JSON.stringify({ query: 'payment terms', topK: 5, sourceId: 'u1' }),
                        },
                      },
                    ],
                  },
                  finish_reason: 'tool_calls',
                },
              ],
            }),
          ]),
        } as any
      }

      return {
        ok: true,
        status: 200,
        statusText: 'OK',
        body: createSseStream([
          JSON.stringify({
            model: 'robian:latest',
            choices: [
              {
                delta: {
                  content:
                    'The payment terms are Net 30. [source: contract.txt p.1-1 chunk:u1:0]',
                },
                finish_reason: 'stop',
              },
            ],
          }),
        ]),
      } as any
    }) as any

    const { req, res } = createReqRes({
      body: { messages: [{ role: 'user', content: 'In upload u1, what are the payment terms?' }] },
    })

    await handleChat(req, res)
    await consumeDone

    expect(res.statusCode).toBe(200)
    expect(pipeSpy).toHaveBeenCalledTimes(1)

    expect(rag.query).toHaveBeenCalledTimes(1)
    expect(rag.query).toHaveBeenCalledWith('payment terms', 5, { source: 'upload', sourceId: 'u1' })

    const events = parseCapturedChunks()
    const firstToolCallIndex = events.findIndex((e) => e?.type === 'tool_call')
    const firstContentIndex = events.findIndex((e) => e?.type === 'content')
    expect(firstToolCallIndex).toBeGreaterThanOrEqual(0)
    expect(firstContentIndex).toBeGreaterThanOrEqual(0)
    expect(firstToolCallIndex).toBeLessThan(firstContentIndex)

    expect(capturedSse).toMatch(/\[source:/i)
  })

  it('general knowledge query does not call rag_search_uploads', async () => {
    const rag = {
      upsertDocuments: async () => ({ ok: true, upserted: 0 }),
      deleteDocuments: async () => ({ ok: true, deleted: 0 }),
      query: vi.fn(async () => ({ ok: true, query: 'q', results: [] })),
    }

    const handleChat = createHandleChat({ ragService: rag as any })

    globalThis.fetch = vi.fn(async () => {
      return {
        ok: true,
        status: 200,
        statusText: 'OK',
        body: createSseStream([
          JSON.stringify({
            model: 'robian:latest',
            choices: [
              {
                delta: { content: 'Paris.' },
                finish_reason: 'stop',
              },
            ],
          }),
        ]),
      } as any
    }) as any

    const { req, res } = createReqRes({
      body: { messages: [{ role: 'user', content: 'What is the capital of France?' }] },
    })

    await handleChat(req, res)
    await consumeDone

    expect(res.statusCode).toBe(200)
    expect(rag.query).toHaveBeenCalledTimes(0)
    expect(capturedSse).toContain('Paris')
  })
})

describe('handleChat RAG_AUTONUDGE', () => {
  const originalEnv = process.env
  const originalFetch = globalThis.fetch

  beforeEach(() => {
    process.env = { ...originalEnv, RAG_AUTONUDGE: 'true' }
  })

  afterEach(() => {
    process.env = originalEnv
    globalThis.fetch = originalFetch
  })

  it('nudges once when doc-related answer has no citations', async () => {
    const rag = {
      upsertDocuments: async () => ({ ok: true, upserted: 0 }),
      deleteDocuments: async () => ({ ok: true, deleted: 0 }),
      query: vi.fn(async () => ({
        ok: true,
        query: 'In upload u1, what are the payment terms?',
        results: [
          {
            id: 'u1:0',
            chunkId: 'u1:0',
            documentId: 'u1',
            filename: 'contract.txt',
            pageStart: 1,
            pageEnd: 1,
            score: 0.9,
            source: 'upload',
            sourceId: 'u1',
            excerpt: 'Net 30.',
          },
        ],
      })),
    }

    const handleChat = createHandleChat({ ragService: rag as any })

    let call = 0
    globalThis.fetch = vi.fn(async () => {
      call++
      if (call === 1) {
        // First response: no tool calls, no citations.
        return {
          ok: true,
          status: 200,
          statusText: 'OK',
          body: createSseStream([
            JSON.stringify({
              model: 'robian:latest',
              choices: [
                {
                  delta: { content: 'The payment terms are Net 30.' },
                  finish_reason: 'stop',
                },
              ],
            }),
          ]),
        } as any
      }

      // Second response: includes citations after forced RAG tool injection.
      return {
        ok: true,
        status: 200,
        statusText: 'OK',
        body: createSseStream([
          JSON.stringify({
            model: 'robian:latest',
            choices: [
              {
                delta: {
                  content:
                    'The payment terms are Net 30. [source: contract.txt p.1-1 chunk:u1:0]',
                },
                finish_reason: 'stop',
              },
            ],
          }),
        ]),
      } as any
    }) as any

    const { req, res } = createReqRes({
      body: { messages: [{ role: 'user', content: 'In upload u1, what are the payment terms?' }] },
    })

    await handleChat(req, res)
    await consumeDone

    expect(res.statusCode).toBe(200)
    expect(call).toBe(2)
    expect(rag.query).toHaveBeenCalledTimes(1)
    expect(rag.query).toHaveBeenCalledWith(expect.any(String), expect.any(Number), { source: 'upload', sourceId: 'u1' })
    expect(capturedSse).toMatch(/\[source:/i)
  })
})
