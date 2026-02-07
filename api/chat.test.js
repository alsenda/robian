import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { EventEmitter } from 'node:events'

let capturedAbortController
let pipeSpy

vi.mock('@tanstack/ai-openai', () => {
  return {
    openai: vi.fn(() => ({ name: 'openai-adapter-mock' })),
  }
})

vi.mock('@tanstack/ai', () => {
  return {
    convertMessagesToModelMessages: vi.fn((messages) => messages),
    chat: vi.fn((opts) => {
      capturedAbortController = opts.abortController
      return (async function* () {
        yield { type: 'content', id: '1', model: opts.model, timestamp: Date.now(), delta: 'hi', content: 'hi' }
      })()
    }),
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
      fromWeb: vi.fn(() => ({
        pipe: pipeSpy,
      })),
    },
  }
})

// Import after mocks
const { handleChat } = await import('./chat.js')

function createReqRes({ body } = {}) {
  const req = new EventEmitter()
  req.body = body

  const headers = new Map()
  const res = {
    statusCode: undefined,
    status(code) {
      this.statusCode = code
      return this
    },
    setHeader(key, value) {
      headers.set(key, value)
    },
    flushHeaders: vi.fn(),
    jsonPayload: undefined,
    json(payload) {
      this.jsonPayload = payload
      return this
    },
  }

  return { req, res, headers }
}

describe('handleChat', () => {
  const originalEnv = process.env

  beforeEach(() => {
    capturedAbortController = undefined
    process.env = { ...originalEnv }
    delete process.env.OPENAI_MODEL
  })

  afterEach(() => {
    process.env = originalEnv
  })

  it('returns 400 when messages missing', async () => {
    process.env.OPENAI_API_KEY = 'test'
    const { req, res } = createReqRes({ body: {} })

    await handleChat(req, res)

    expect(res.statusCode).toBe(400)
    expect(res.jsonPayload).toEqual({
      error: 'Missing "messages" array in request body',
    })
  })

  it('returns 500 when OPENAI_API_KEY missing', async () => {
    delete process.env.OPENAI_API_KEY
    const { req, res } = createReqRes({ body: { messages: [] } })

    await handleChat(req, res)

    expect(res.statusCode).toBe(500)
    expect(res.jsonPayload).toEqual({ error: 'OPENAI_API_KEY not configured' })
  })

  it('streams SSE and aborts on close', async () => {
    process.env.OPENAI_API_KEY = 'test'
    process.env.OPENAI_MODEL = 'gpt-test'

    const { req, res, headers } = createReqRes({
      body: { messages: [{ role: 'user', content: 'hello' }] },
    })

    await handleChat(req, res)

    expect(res.statusCode).toBe(200)
    expect(headers.get('Content-Type')).toBe('text/event-stream')
    expect(pipeSpy).toHaveBeenCalledTimes(1)

    expect(capturedAbortController).toBeDefined()
    expect(capturedAbortController.signal.aborted).toBe(false)
    req.emit('close')
    expect(capturedAbortController.signal.aborted).toBe(true)
  })
})
