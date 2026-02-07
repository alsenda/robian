import { convertMessagesToModelMessages, toServerSentEventsStream } from '@tanstack/ai'
import { randomUUID } from 'node:crypto'
import { Readable } from 'node:stream'

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

function toOllamaMessages(modelMessages) {
  return modelMessages
    .map((msg) => {
      const role = msg.role === 'tool' ? 'assistant' : msg.role
      return {
        role,
        content: getTextContent(msg.content),
      }
    })
    .filter((m) => m.content.length > 0)
}

async function* streamOllamaAsTanstackChunks({
  response,
  requestId,
  model,
  abortSignal,
}) {
  const decoder = new TextDecoder()
  const reader = response.body?.getReader()
  if (!reader) {
    yield {
      type: 'error',
      id: requestId,
      model,
      timestamp: Date.now(),
      error: { message: 'Ollama response body is not readable' },
    }
    return
  }

  let buffer = ''
  let fullContent = ''
  let resolvedModel = model

  const usage = {
    promptTokens: 0,
    completionTokens: 0,
    totalTokens: 0,
  }

  try {
    while (true) {
      if (abortSignal?.aborted) {
        return
      }

      const { done, value } = await reader.read()
      if (done) break

      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split('\n')
      buffer = lines.pop() || ''

      for (const line of lines) {
        const trimmed = line.trim()
        if (!trimmed) continue

        let parsed
        try {
          parsed = JSON.parse(trimmed)
        } catch {
          continue
        }

        if (typeof parsed?.model === 'string') {
          resolvedModel = parsed.model
        }

        const delta = parsed?.message?.content
        if (typeof delta === 'string' && delta.length > 0) {
          fullContent += delta
          yield {
            type: 'content',
            id: requestId,
            model: resolvedModel,
            timestamp: Date.now(),
            delta,
            content: fullContent,
            role: 'assistant',
          }
        }

        if (typeof parsed?.prompt_eval_count === 'number') {
          usage.promptTokens = parsed.prompt_eval_count
        }
        if (typeof parsed?.eval_count === 'number') {
          usage.completionTokens = parsed.eval_count
        }
        usage.totalTokens = usage.promptTokens + usage.completionTokens

        if (parsed?.done) {
          yield {
            type: 'done',
            id: requestId,
            model: resolvedModel,
            timestamp: Date.now(),
            finishReason: 'stop',
            ...(usage.totalTokens > 0 ? { usage } : {}),
          }
          return
        }
      }
    }

    yield {
      type: 'done',
      id: requestId,
      model: resolvedModel,
      timestamp: Date.now(),
      finishReason: 'stop',
      ...(usage.totalTokens > 0 ? { usage } : {}),
    }
  } catch (error) {
    if (abortSignal?.aborted) return
    yield {
      type: 'error',
      id: requestId,
      model: resolvedModel,
      timestamp: Date.now(),
      error: { message: error?.message || 'Ollama stream error' },
    }
  } finally {
    reader.releaseLock()
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
    const ollamaMessages = toOllamaMessages(modelMessages)

    let ollamaResponse
    try {
      ollamaResponse = await fetch(`${ollamaUrl}/api/chat`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model,
          messages: ollamaMessages,
          stream: true,
        }),
        signal: abortController.signal,
      })
    } catch (error) {
      if (abortController.signal.aborted) {
        return
      }
      return res.status(502).json({
        error: `Could not reach Ollama at ${ollamaUrl} (is it running?)`,
      })
    }

    if (!ollamaResponse.ok) {
      const status = ollamaResponse.status || 502
      return res.status(status).json({
        error: `Ollama error: ${ollamaResponse.status} ${ollamaResponse.statusText}`,
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
    const stream = streamOllamaAsTanstackChunks({
      response: ollamaResponse,
      requestId,
      model,
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
