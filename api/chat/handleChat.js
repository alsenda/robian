import {
  convertMessagesToModelMessages,
  toServerSentEventsStream,
} from '@tanstack/ai'
import { randomUUID } from 'node:crypto'
import { Readable } from 'node:stream'

import { getSystemPromptForModel } from './systemPrompt.js'
import { toOpenAiMessages } from './utils/messages.js'
import { dateTodayDef, fetchUrlDef, searchWebDef, toOpenAiTools } from './tools/index.js'
import { streamOllamaOpenAiOnce } from './ollama/client.js'
import { streamChatWithTools } from './streamChat.js'

const DEFAULT_OLLAMA_URL = 'http://localhost:11434'
const DEFAULT_OLLAMA_MODEL = 'robian:latest'

function stripTrailingSlashes(text) {
  return String(text || '').replace(/\/+$/, '')
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

    const ollamaUrl = stripTrailingSlashes(process.env.OLLAMA_URL || DEFAULT_OLLAMA_URL)
    const model = process.env.OLLAMA_MODEL || DEFAULT_OLLAMA_MODEL
    const requestId = randomUUID()

    if (process.env.NODE_ENV !== 'test') {
      console.log(`[chat] model: ${model}`)
    }

    const modelMessages = convertMessagesToModelMessages(messages)
    const openAiMessages = toOpenAiMessages(modelMessages)

    const tools = toOpenAiTools([searchWebDef, fetchUrlDef, dateTodayDef])

    const system = {
      role: 'system',
      content: getSystemPromptForModel(model),
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
      if (process.env.NODE_ENV !== 'test') {
        console.error(
          `[chat] ollama unreachable: ${error?.message || 'unknown error'}`,
        )
      }
      return res.status(502).json({
        error: `Could not reach Ollama at ${ollamaUrl} (is it running?)`,
      })
    }

    if (!firstResponse.ok) {
      const status = firstResponse.status || 502
      if (process.env.NODE_ENV !== 'test') {
        console.error(
          `[chat] ollama error: ${firstResponse.status} ${firstResponse.statusText}`,
        )
      }
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
