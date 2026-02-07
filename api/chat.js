import {
  convertMessagesToModelMessages,
  convertZodToJsonSchema,
  toServerSentEventsStream,
  toolDefinition,
} from '@tanstack/ai'
import { randomUUID } from 'node:crypto'
import dns from 'node:dns/promises'
import net from 'node:net'
import { Readable } from 'node:stream'
import { z } from 'zod'

function getTextContent(content) {
  if (content == null) return ''
  if (typeof content === 'string') return content
  if (Array.isArray(content)) {
    return content
      .filter((part) => part && part.type === 'text')
      .map((part) => part.content)
      .join('')
  }
  return String(content)
}

function toOpenAiMessages(modelMessages) {
  return modelMessages
    .map((msg) => ({
      role: msg.role,
      content: getTextContent(msg.content),
    }))
    .filter((m) => typeof m.content === 'string' && m.content.length > 0)
}

function isPrivateIp(ip) {
  const version = net.isIP(ip)
  if (!version) return false

  if (version === 6) {
    const normalized = ip.toLowerCase()
    if (normalized === '::1') return true
    if (normalized.startsWith('fc') || normalized.startsWith('fd')) return true // unique local
    if (normalized.startsWith('fe80:')) return true // link-local
    return false
  }

  const [a, b] = ip.split('.').map((n) => Number(n))
  if (a === 127) return true
  if (a === 10) return true
  if (a === 0) return true
  if (a === 169 && b === 254) return true
  if (a === 172 && b >= 16 && b <= 31) return true
  if (a === 192 && b === 168) return true
  return false
}

async function assertPublicHostname(hostname) {
  const clean = hostname.replace(/\.$/, '')
  if (!clean) throw new Error('Invalid hostname')

  const ipVersion = net.isIP(clean)
  if (ipVersion) {
    if (isPrivateIp(clean)) throw new Error('Blocked private IP address')
    return
  }

  if (clean === 'localhost') throw new Error('Blocked hostname')

  const records = await dns.lookup(clean, { all: true })
  if (!records?.length) throw new Error('Could not resolve hostname')
  for (const record of records) {
    if (record?.address && isPrivateIp(record.address)) {
      throw new Error('Blocked private IP address')
    }
  }
}

function stripHtmlToText(html) {
  let text = String(html)
  text = text.replace(/<script[\s\S]*?<\/script>/gi, ' ')
  text = text.replace(/<style[\s\S]*?<\/style>/gi, ' ')
  text = text.replace(/<[^>]+>/g, ' ')
  text = text
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
  return text.replace(/\s+/g, ' ').trim()
}

async function fetchTextFromUrl({ url, timeoutMs = 12_000, maxBytes = 1_000_000 }) {
  const parsed = new URL(url)
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error('Only http/https URLs are allowed')
  }

  await assertPublicHostname(parsed.hostname)

  const abortController = new AbortController()
  const timeout = setTimeout(() => abortController.abort(), timeoutMs)
  try {
    const response = await fetch(parsed.toString(), {
      method: 'GET',
      headers: {
        'User-Agent': 'theapp/1.0',
        Accept: 'text/html, text/plain;q=0.9, application/json;q=0.5, */*;q=0.1',
      },
      signal: abortController.signal,
    })

    const contentType = response.headers.get('content-type') || ''
    const reader = response.body?.getReader()
    if (!reader) throw new Error('Response body is not readable')

    const chunks = []
    let received = 0
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      if (value) {
        received += value.byteLength
        if (received > maxBytes) {
          throw new Error('Response too large')
        }
        chunks.push(value)
      }
    }

    const all = new Uint8Array(received)
    let offset = 0
    for (const chunk of chunks) {
      all.set(chunk, offset)
      offset += chunk.byteLength
    }

    const decoded = new TextDecoder('utf-8', { fatal: false }).decode(all)
    const text = contentType.includes('text/html') ? stripHtmlToText(decoded) : decoded.trim()

    return {
      url: parsed.toString(),
      status: response.status,
      contentType,
      text,
    }
  } finally {
    clearTimeout(timeout)
  }
}

const fetchUrlDef = toolDefinition({
  name: 'fetch_url',
  description:
    'Fetch and extract readable text from a public http(s) URL. Use this to retrieve web page content when the user asks to look something up or provides a URL.',
  inputSchema: z.object({
    url: z.string().url().describe('The http(s) URL to fetch'),
    maxChars: z
      .number()
      .int()
      .min(500)
      .max(20_000)
      .optional()
      .describe('Maximum number of characters of extracted text to return'),
  }),
  outputSchema: z.object({
    url: z.string(),
    status: z.number(),
    content: z.string(),
  }),
})

const fetchUrlTool = fetchUrlDef.server(async ({ url, maxChars }) => {
  const result = await fetchTextFromUrl({ url })
  const limit = typeof maxChars === 'number' ? maxChars : 8_000
  return {
    url: result.url,
    status: result.status,
    content: result.text.slice(0, limit),
  }
})

function toOpenAiTools(tools) {
  return tools.map((tool) => ({
    type: 'function',
    function: {
      name: tool.name,
      description: tool.description,
      parameters: convertZodToJsonSchema(tool.inputSchema),
    },
  }))
}

async function streamOllamaOpenAiOnce({
  ollamaUrl,
  model,
  openAiMessages,
  tools,
  requestId,
  abortSignal,
}) {
  const response = await fetch(`${ollamaUrl}/v1/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model,
      messages: openAiMessages,
      stream: true,
      tools,
      tool_choice: 'auto',
    }),
    signal: abortSignal,
  })

  return response
}

function createOpenAiStreamParser({ requestId, model, abortSignal }) {
  const state = {
    fullContent: '',
    finishReason: 'stop',
    toolCallsByIndex: new Map(),
    resolvedModel: model,
  }

  const parse = async function* ({ response }) {
    const decoder = new TextDecoder()
    const reader = response.body?.getReader()
    if (!reader) {
      throw new Error('Ollama response body is not readable')
    }

    let buffer = ''
    try {
      while (true) {
        if (abortSignal?.aborted) return
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })

        const lines = buffer.split('\n')
        buffer = lines.pop() || ''

        for (const line of lines) {
          const trimmed = line.trim()
          if (!trimmed.startsWith('data:')) continue
          const payload = trimmed.slice('data:'.length).trim()
          if (!payload) continue
          if (payload === '[DONE]') return

          let parsed
          try {
            parsed = JSON.parse(payload)
          } catch {
            continue
          }

          if (typeof parsed?.model === 'string') {
            state.resolvedModel = parsed.model
          }

          const choice = parsed?.choices?.[0]
          const delta = choice?.delta

          if (typeof choice?.finish_reason === 'string') {
            state.finishReason = choice.finish_reason
          }

          const contentDelta = delta?.content
          if (typeof contentDelta === 'string' && contentDelta.length > 0) {
            state.fullContent += contentDelta
            yield {
              type: 'content',
              id: requestId,
              model: state.resolvedModel,
              timestamp: Date.now(),
              delta: contentDelta,
              content: state.fullContent,
              role: 'assistant',
            }
          }

          const toolDeltas = delta?.tool_calls
          if (Array.isArray(toolDeltas)) {
            for (let i = 0; i < toolDeltas.length; i++) {
              const toolDelta = toolDeltas[i]
              const index = typeof toolDelta?.index === 'number' ? toolDelta.index : i

              const existing = state.toolCallsByIndex.get(index) || {
                id: toolDelta?.id || randomUUID(),
                name: toolDelta?.function?.name || '',
                arguments: '',
              }

              if (typeof toolDelta?.id === 'string' && toolDelta.id) {
                existing.id = toolDelta.id
              }
              if (typeof toolDelta?.function?.name === 'string' && toolDelta.function.name) {
                existing.name = toolDelta.function.name
              }

              const argsDelta =
                typeof toolDelta?.function?.arguments === 'string'
                  ? toolDelta.function.arguments
                  : ''

              if (argsDelta) existing.arguments += argsDelta

              state.toolCallsByIndex.set(index, existing)

              if (existing.name) {
                yield {
                  type: 'tool-call',
                  index,
                  toolCall: {
                    id: existing.id,
                    function: {
                      name: existing.name,
                      arguments: argsDelta,
                    },
                  },
                }
              }
            }
          }
        }
      }
    } finally {
      reader.releaseLock()
    }
  }

  return { state, parse }
}

async function* streamChatWithTools({
  ollamaUrl,
  model,
  requestId,
  openAiMessages,
  firstResponse,
  tools,
  abortSignal,
}) {
  const serverTools = [fetchUrlTool]

  const system = {
    role: 'system',
    content:
      'You are a helpful assistant. When useful, you may call tools to retrieve information. If you need the contents of a webpage, call the fetch_url tool with a public http(s) URL.',
  }

  const conversation = [system, ...openAiMessages]

  for (let iteration = 0; iteration < 3; iteration++) {
    if (abortSignal?.aborted) return

    let response = firstResponse
    if (iteration > 0 || !response) {
      try {
        response = await streamOllamaOpenAiOnce({
          ollamaUrl,
          model,
          openAiMessages: conversation,
          tools,
          requestId,
          abortSignal,
        })
      } catch (error) {
        if (abortSignal?.aborted) return
        yield {
          type: 'error',
          id: requestId,
          model,
          timestamp: Date.now(),
          error: { message: error?.message || 'Could not reach Ollama' },
        }
        return
      }

      if (!response.ok) {
        yield {
          type: 'error',
          id: requestId,
          model,
          timestamp: Date.now(),
          error: {
            message: `Ollama error: ${response.status} ${response.statusText}`,
          },
        }
        return
      }
    }

    firstResponse = null

    const { state, parse } = createOpenAiStreamParser({
      requestId,
      model,
      abortSignal,
    })

    for await (const chunk of parse({ response })) {
      yield chunk
    }

    const toolCalls = [...state.toolCallsByIndex.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([, value]) => value)
      .filter((c) => c && c.name)

    if (!toolCalls.length) {
      yield {
        type: 'done',
        id: requestId,
        model: state.resolvedModel,
        timestamp: Date.now(),
        finishReason: state.finishReason || 'stop',
      }
      return
    }

    conversation.push({
      role: 'assistant',
      content: state.fullContent || null,
      tool_calls: toolCalls.map((c) => ({
        id: c.id,
        type: 'function',
        function: {
          name: c.name,
          arguments: c.arguments,
        },
      })),
    })

    for (const toolCall of toolCalls) {
      const tool = serverTools.find((t) => t.name === toolCall.name)
      if (!tool) {
        const errorText = `Unknown tool: ${toolCall.name}`
        yield {
          type: 'tool-result',
          toolCallId: toolCall.id,
          content: errorText,
        }
        conversation.push({
          role: 'tool',
          tool_call_id: toolCall.id,
          content: errorText,
        })
        continue
      }

      let parsedArgs
      try {
        parsedArgs = toolCall.arguments ? JSON.parse(toolCall.arguments) : {}
      } catch (error) {
        const errorText = `Invalid tool arguments: ${error?.message || 'parse error'}`
        yield {
          type: 'tool-result',
          toolCallId: toolCall.id,
          content: errorText,
        }
        conversation.push({
          role: 'tool',
          tool_call_id: toolCall.id,
          content: errorText,
        })
        continue
      }

      try {
        const output = await tool.execute(parsedArgs)
        const content = typeof output === 'string' ? output : JSON.stringify(output)
        yield {
          type: 'tool-result',
          toolCallId: toolCall.id,
          content,
        }
        conversation.push({
          role: 'tool',
          tool_call_id: toolCall.id,
          content,
        })
      } catch (error) {
        const errorText = error?.message || 'Tool execution failed'
        yield {
          type: 'tool-result',
          toolCallId: toolCall.id,
          content: errorText,
        }
        conversation.push({
          role: 'tool',
          tool_call_id: toolCall.id,
          content: errorText,
        })
      }
    }
  }

  yield {
    type: 'done',
    id: requestId,
    model,
    timestamp: Date.now(),
    finishReason: 'stop',
  }
}

/**
 * API endpoint for chat
 * This should be integrated with your backend server (Express, etc.)
 * 
 * Example usage with Express:
 * app.post('/api/chat', handleChat)
 */
export async function handleChat(req, res) {
  const { messages } = req.body ?? {}

  if (!messages || !Array.isArray(messages)) {
    return res.status(400).json({ error: 'Missing "messages" array in request body' })
  }

  try {
    const abortController = new AbortController()
    // Abort when the client disconnects (SSE response closes)
    res.on('close', () => abortController.abort())
    req.on('aborted', () => abortController.abort())

    if (process.env.NODE_ENV !== 'test') {
      console.log(`[chat] request: messages=${messages.length}`)
    }

    const ollamaUrl = (process.env.OLLAMA_URL || 'http://localhost:11434').replace(
      /\/+$/,
      '',
    )
    const model = process.env.OLLAMA_MODEL || 'llama3.2:latest'
    const requestId = randomUUID()

    const modelMessages = convertMessagesToModelMessages(messages)
    const openAiMessages = toOpenAiMessages(modelMessages)

    const tools = toOpenAiTools([fetchUrlDef])

    const system = {
      role: 'system',
      content:
        'You are a helpful assistant. When useful, you may call tools to retrieve information. If you need the contents of a webpage, call the fetch_url tool with a public http(s) URL.',
    }

    const firstConversation = [system, ...openAiMessages]

    let firstResponse
    try {
      firstResponse = await streamOllamaOpenAiOnce({
        ollamaUrl,
        model,
        openAiMessages: firstConversation,
        tools,
        requestId,
        abortSignal: abortController.signal,
      })
    } catch (error) {
      if (abortController.signal.aborted) return
      return res.status(502).json({
        error: `Could not reach Ollama at ${ollamaUrl} (is it running?)`,
      })
    }

    if (!firstResponse.ok) {
      const status = firstResponse.status || 502
      return res.status(status).json({
        error: `Ollama error: ${firstResponse.status} ${firstResponse.statusText}`,
      })
    }

    res.status(200)
    res.setHeader('Content-Type', 'text/event-stream')
    res.setHeader('Cache-Control', 'no-cache, no-transform')
    res.setHeader('Connection', 'keep-alive')
    if (typeof res.flushHeaders === 'function') {
      res.flushHeaders()
    }

    // Kick the stream so intermediaries/browsers don't buffer waiting for first chunk
    res.write(': connected\n\n')

    // Send SSE stream
    const stream = streamChatWithTools({
      ollamaUrl,
      model,
      requestId,
      openAiMessages,
      firstResponse,
      tools,
      abortSignal: abortController.signal,
    })

    const sseStream = toServerSentEventsStream(stream, abortController)
    const nodeStream = Readable.fromWeb(sseStream)

    nodeStream.on('error', (error) => {
      if (abortController.signal.aborted) return
      console.error('SSE stream error:', error)
      try {
        res.end()
      } catch {
        // ignore
      }
    })

    res.on('error', (error) => {
      if (abortController.signal.aborted) return
      console.error('Response error:', error)
      abortController.abort()
      nodeStream.destroy(error)
    })

    nodeStream.pipe(res)
  } catch (error) {
    console.error('Chat error:', error)
    res.status(500).json({ error: error.message })
  }
}
