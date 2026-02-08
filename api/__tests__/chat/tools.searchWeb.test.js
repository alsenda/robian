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

describe('search_web tool integration', () => {
  const originalEnv = process.env
  const originalFetch = globalThis.fetch

  const defaultCompletionUrl = 'http://localhost:11434/v1/chat/completions'
  const defaultModel = 'robian:latest'

  beforeEach(() => {
    process.env = { ...originalEnv }
    delete process.env.OLLAMA_URL
    delete process.env.OLLAMA_MODEL
    delete process.env.WEB_SEARCH_PROVIDER
    delete process.env.BRAVE_SEARCH_API_KEY

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

  it('executes search_web tool calls and continues', async () => {
    const completionUrl = defaultCompletionUrl

    const completionBodies = []
    let completionCall = 0

    globalThis.fetch = vi.fn(async (url, init) => {
      const urlText = String(url)

      if (urlText === completionUrl) {
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
                          function: {
                            name: 'search_web',
                            arguments: JSON.stringify({ query: 'hello', count: 3 }),
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

      if (urlText.startsWith('https://api.search.brave.com/res/v1/web/search')) {
        throw new Error('Unexpected Brave call (default provider should be DuckDuckGo)')
      }

      if (urlText.startsWith('https://html.duckduckgo.com/html/')) {
        const html = `
          <div class="results">
            <div class="result">
              <a class="result__a" href="https://duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.com%2Fpage%23frag">Example</a>
              <div class="result__snippet">Snippet</div>
            </div>
            <div class="result">
              <a class="result__a" href="https://example.com/file.pdf">PDF</a>
              <div class="result__snippet">Should be filtered</div>
            </div>
          </div>
        `
        return {
          ok: true,
          status: 200,
          text: async () => html,
        }
      }

      throw new Error(`Unexpected fetch url: ${url}`)
    })

    const { req, res } = createReqRes({
      body: { messages: [{ role: 'user', content: 'search the web' }] },
    })

    await handleChat(req, res)

    await waitFor(() => completionCall >= 2)

    expect(res.statusCode).toBe(200)
    expect(completionCall).toBe(2)

    const second = completionBodies.at(1)
    const toolMsg = second?.messages?.find?.((m) => m?.role === 'tool')
    expect(typeof toolMsg?.content).toBe('string')
    expect(toolMsg.content).toContain('"query":"hello"')
    expect(toolMsg.content).toContain('https://example.com/page')
  })

  it('can switch provider to brave via WEB_SEARCH_PROVIDER', async () => {
    process.env.WEB_SEARCH_PROVIDER = 'brave'
    process.env.BRAVE_SEARCH_API_KEY = 'test_key'

    const completionUrl = defaultCompletionUrl

    const completionBodies = []
    let completionCall = 0

    globalThis.fetch = vi.fn(async (url, init) => {
      const urlText = String(url)

      if (urlText === completionUrl) {
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
                          function: {
                            name: 'search_web',
                            arguments: JSON.stringify({ query: 'hello', count: 3 }),
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

      if (urlText.startsWith('https://api.search.brave.com/res/v1/web/search')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            web: {
              results: [
                {
                  title: 'Example',
                  url: 'https://example.com/page#frag',
                  description: 'Snippet',
                },
                {
                  title: 'PDF',
                  url: 'https://example.com/file.pdf',
                  description: 'Should be filtered',
                },
              ],
            },
          }),
        }
      }

      if (urlText.startsWith('https://html.duckduckgo.com/html/')) {
        throw new Error('Unexpected DuckDuckGo call when provider is brave')
      }

      throw new Error(`Unexpected fetch url: ${url}`)
    })

    const { req, res } = createReqRes({
      body: { messages: [{ role: 'user', content: 'search the web' }] },
    })

    await handleChat(req, res)
    await waitFor(() => completionCall >= 2)

    expect(res.statusCode).toBe(200)
    expect(completionCall).toBe(2)

    const second = completionBodies.at(1)
    const toolMsg = second?.messages?.find?.((m) => m?.role === 'tool')
    expect(typeof toolMsg?.content).toBe('string')
    expect(toolMsg.content).toContain('"query":"hello"')
    expect(toolMsg.content).toContain('https://example.com/page')
  })
})
