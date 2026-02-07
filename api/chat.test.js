import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { EventEmitter } from 'node:events'

let pipeSpy

function createNdjsonStream(lines) {
  const encoder = new TextEncoder()
  return new ReadableStream({
    start(controller) {
      for (const line of lines) {
        controller.enqueue(encoder.encode(`${line}\n`))
      }
      controller.close()
    },
  })
}

vi.mock('@tanstack/ai', () => {
  return {
    convertMessagesToModelMessages: vi.fn((messages) => messages),
    toServerSentEventsStream: vi.fn(() => {
      // Minimal Web ReadableStream; we don't need real bytes
      return new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode('data: {}\n\n'))
          controller.close()
        },
      })
    }),
  }
})

vi.mock('node:stream', () => {
  pipeSpy = vi.fn()
  return {
    Readable: {
      fromWeb: vi.fn(() => {
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

// Import after mocks
const { handleChat } = await import('./chat.js')

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

  beforeEach(() => {
    process.env = { ...originalEnv }
    delete process.env.OLLAMA_URL
    delete process.env.OLLAMA_MODEL

    globalThis.fetch = vi.fn(async () => {
      return {
        ok: true,
        status: 200,
        statusText: 'OK',
        body: createNdjsonStream([
          JSON.stringify({
            model: 'llama3.2:latest',
            message: { role: 'assistant', content: 'hi' },
            done: false,
          }),
          JSON.stringify({
            model: 'llama3.2:latest',
            message: { role: 'assistant', content: '!' },
            done: true,
            prompt_eval_count: 1,
            eval_count: 2,
          }),
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
    process.env.OLLAMA_MODEL = 'llama3.2:latest'

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
