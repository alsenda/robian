import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { EventEmitter } from 'node:events'

let pipeSpy: ReturnType<typeof vi.fn>

function createSseStream(dataEvents: string[]) {
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

async function waitFor(conditionFn: () => boolean, { maxAttempts = 50, delayMs = 5 } = {}) {
  for (let i = 0; i < maxAttempts; i++) {
    if (conditionFn()) return
    // eslint-disable-next-line no-await-in-loop
    await new Promise((resolve) => setTimeout(resolve, delayMs))
  }
}

vi.mock('@tanstack/ai', async (importOriginal) => {
  const actual = await importOriginal<any>()
  return {
    ...actual,
    convertMessagesToModelMessages: vi.fn((messages: unknown) => messages),
  }
})

vi.mock('node:stream', () => {
  pipeSpy = vi.fn()
  return {
    Readable: {
      fromWeb: vi.fn((webStream: any) => {
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

const { handleChat } = await import('../../chat/index.ts')

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

describe('fetch_url tool integration (TS)', () => {
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
          JSON.stringify({ model: defaultModel, choices: [{ delta: { content: 'hi' } }] }),
          JSON.stringify({ model: defaultModel, choices: [{ delta: { content: '!' }, finish_reason: 'stop' }] }),
          '[DONE]',
        ]),
      } as any
    })
  })

  afterEach(() => {
    process.env = originalEnv
    globalThis.fetch = originalFetch
  })

  it('executes fetch_url tool calls and continues', async () => {
    const completionUrl = defaultCompletionUrl
    const webUrl = 'https://93.184.216.34/'

    let completionCall = 0
    globalThis.fetch = vi.fn(async (url, init) => {
      if (String(url) === completionUrl) {
        completionCall += 1
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
                          function: {
                            name: 'fetch_url',
                            arguments: JSON.stringify({ url: webUrl, maxChars: 600 }),
                          },
                        },
                      ],
                    },
                    finish_reason: 'tool_calls',
                  },
                ],
              }),
              '[DONE]',
            ]),
          } as any
        }

        return {
          ok: true,
          status: 200,
          statusText: 'OK',
          body: createSseStream([
            JSON.stringify({ model: defaultModel, choices: [{ delta: { content: 'Done.' }, finish_reason: 'stop' }] }),
            '[DONE]',
          ]),
        } as any
      }

      if (String(url) === webUrl) {
        return {
          status: 200,
          headers: new Map([['content-type', 'text/html']]),
          body: new ReadableStream({
            start(controller) {
              controller.enqueue(
                new TextEncoder().encode('<html><body><h1>Hi</h1><p>World</p></body></html>'),
              )
              controller.close()
            },
          }),
        } as any
      }

      throw new Error(`Unexpected fetch url: ${String(url)}`)
    }) as any

    const { req, res } = createReqRes({
      body: { messages: [{ role: 'user', content: 'fetch that url' }] },
    })

    await handleChat(req, res)
    await waitFor(() => completionCall >= 2)

    expect(res.statusCode).toBe(200)
    expect(completionCall).toBe(2)
    expect(globalThis.fetch).toHaveBeenCalledWith(webUrl, expect.any(Object))
  })
})
