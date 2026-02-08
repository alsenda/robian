import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { EventEmitter } from 'node:events'

let pipeSpy

function createSseStream(dataEvents) {
  const encoder = new TextEncoder()
  return new ReadableStream({
    start(controller) {
      for (const event of dataEvents) {
        controller.enqueue(encoder.encode(`data: ${event}\n\n`))
      }
      controller.close()
    },
  })
}

vi.mock('@tanstack/ai', async (importOriginal) => {
  const actual = await importOriginal()
  return {
    ...actual,
    convertMessagesToModelMessages: vi.fn((messages) => messages),
  }
})

vi.mock('node:stream', () => {
  pipeSpy = vi.fn()
  return {
    Readable: {
      fromWeb: vi.fn((webStream) => {
        // Consume the web stream so the async generator runs.
        if (webStream && typeof webStream.getReader === 'function') {
          const reader = webStream.getReader()
          ;(async () => {
            try {
              while (true) {
                const { done } = await reader.read()
                if (done) break
              }
            } finally {
              try {
                reader.releaseLock()
              } catch {
                // ignore
              }
            }
          })()
        }

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

const { handleChat } = await import('../../chat/index.js')

function createReqRes({ body } = {}) {
  const req = new EventEmitter()
  req.body = body

  const headers = new Map()
  const res = new EventEmitter()
  Object.assign(res, {
    statusCode: undefined,
    status(code) {
      this.statusCode = code
      return this
    },
    setHeader(key, value) {
      headers.set(key, value)
    },
    flushHeaders: vi.fn(),
    write: vi.fn(),
    end: vi.fn(),
    jsonPayload: undefined,
    json(payload) {
      this.jsonPayload = payload
      return this
    },
  })

  return { req, res, headers }
}

describe('handleChat', () => {
  const originalEnv = process.env
  const originalFetch = globalThis.fetch

  const defaultModel = 'robian:latest'

  beforeEach(() => {
    process.env = { ...originalEnv }
    delete process.env.OLLAMA_URL
    delete process.env.OLLAMA_MODEL

    globalThis.fetch = vi.fn(async () => {
      return {
        ok: true,
        status: 200,
        statusText: 'OK',
        body: createSseStream([
          JSON.stringify({
            model: defaultModel,
            choices: [{ delta: { content: 'hi' } }],
          }),
          JSON.stringify({
            model: defaultModel,
            choices: [{ delta: { content: '!' }, finish_reason: 'stop' }],
          }),
          '[DONE]',
        ]),
      }
    })
  })

  afterEach(() => {
    process.env = originalEnv
    globalThis.fetch = originalFetch
  })

  it('returns 400 when messages missing', async () => {
    const { req, res } = createReqRes({ body: {} })

    await handleChat(req, res)

    expect(res.statusCode).toBe(400)
    expect(res.jsonPayload).toEqual({
      error: 'Missing "messages" array in request body',
    })
  })

  it('returns 502 when Ollama is unreachable', async () => {
    globalThis.fetch = vi.fn(async () => {
      throw new Error('connect ECONNREFUSED')
    })

    const { req, res } = createReqRes({ body: { messages: [] } })
    await handleChat(req, res)

    expect(res.statusCode).toBe(502)
    expect(res.jsonPayload?.error).toContain('Could not reach Ollama')
  })

  it('streams SSE and aborts on close', async () => {
    process.env.OLLAMA_URL = 'http://localhost:11434'
    process.env.OLLAMA_MODEL = defaultModel

    const { req, res, headers } = createReqRes({
      body: { messages: [{ role: 'user', content: 'hello' }] },
    })

    await handleChat(req, res)

    expect(res.statusCode).toBe(200)
    expect(headers.get('Content-Type')).toBe('text/event-stream')
    expect(pipeSpy).toHaveBeenCalledTimes(1)

    // Closing the SSE response should not throw
    res.emit('close')
  })
})
