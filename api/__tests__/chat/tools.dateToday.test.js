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

async function waitFor(conditionFn, { maxAttempts = 50, delayMs = 5 } = {}) {
  for (let i = 0; i < maxAttempts; i++) {
    if (conditionFn()) return
    // eslint-disable-next-line no-await-in-loop
    await new Promise((resolve) => setTimeout(resolve, delayMs))
  }
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

describe('date_today tool integration', () => {
  const originalEnv = process.env
  const originalFetch = globalThis.fetch

  const defaultCompletionUrl = 'http://localhost:11434/v1/chat/completions'
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

  it('executes date_today even when tool call uses parameters object', async () => {
    const completionBodies = []
    let completionCall = 0

    globalThis.fetch = vi.fn(async (url, init) => {
      if (String(url) === defaultCompletionUrl) {
        completionCall += 1
        if (init?.body) {
          try {
            completionBodies.push(JSON.parse(String(init.body)))
          } catch {
            // ignore
          }
        }

        if (completionCall === 1) {
          return {
            ok: true,
            status: 200,
            statusText: 'OK',
            body: createSseStream([
              JSON.stringify({
                model: defaultModel,
                choices: [
                  {
                    delta: {
                      tool_calls: [
                        {
                          index: 0,
                          id: 'call_1',
                          name: 'date_today',
                          parameters: {},
                        },
                      ],
                    },
                    finish_reason: 'tool_calls',
                  },
                ],
              }),
              '[DONE]',
            ]),
          }
        }

        return {
          ok: true,
          status: 200,
          statusText: 'OK',
          body: createSseStream([
            JSON.stringify({
              model: defaultModel,
              choices: [{ delta: { content: 'Done.' }, finish_reason: 'stop' }],
            }),
            '[DONE]',
          ]),
        }
      }

      throw new Error(`Unexpected fetch url: ${url}`)
    })

    const { req, res } = createReqRes({
      body: { messages: [{ role: 'user', content: "what's today's date?" }] },
    })

    await handleChat(req, res)

    await waitFor(() => completionCall >= 2)

    expect(res.statusCode).toBe(200)
    expect(completionCall).toBe(2)

    const second = completionBodies.at(1)
    const toolMsg = second?.messages?.find?.((m) => m?.role === 'tool')
    expect(typeof toolMsg?.content).toBe('string')
    // Tool content should be an en-US locale date string.
    expect(toolMsg.content).toMatch(/\d{1,2}\/\d{1,2}\/\d{4}/)
  })
})
