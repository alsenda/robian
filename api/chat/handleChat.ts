import {
  convertMessagesToModelMessages,
  toServerSentEventsStream,
} from '@tanstack/ai'
import { randomUUID } from 'node:crypto'
import { Readable } from 'node:stream'
import type { Request, Response as ExpressResponse } from 'express'

import { getPromptPrefixMessagesForModel } from './systemPrompt.ts'
import { toChatCompletionsMessages } from './utils/messages.ts'
import {
  dateTodayDef,
  fetchUrlDef,
  getUploadDef,
  listUploadsDef,
  ragSearchUploadsDef,
  searchWebDef,
  toChatCompletionsTools,
  createServerTools,
} from './tools/index.ts'
import { streamOllamaChatCompletionsOnce } from './ollama/client.ts'
import { streamChatWithTools } from './streamChat.ts'
import type { RagService } from '../rag/types.ts'

const DEFAULT_OLLAMA_URL = 'http://localhost:11434'
const DEFAULT_OLLAMA_MODEL = 'robian:latest'

function stripTrailingSlashes(text: string): string {
  return String(text || '').replace(/\/+$/, '')
}

export function createHandleChat({
  ragService,
}: {
  ragService: RagService
}): (req: Request, res: ExpressResponse) => Promise<void> {
  const serverTools = createServerTools({ rag: ragService })

  return async function handleChat(req: Request, res: ExpressResponse): Promise<void> {
    const { messages } = (req.body as { messages?: unknown } | undefined) ?? {}

    if (!messages || !Array.isArray(messages)) {
      res.status(400).json({ error: 'Missing "messages" array in request body' })
      return
    }

    try {
      const abortController = new AbortController()
      res.on('close', () => abortController.abort())
      req.on('aborted', () => abortController.abort())

      if (process.env.NODE_ENV !== 'test') {
        console.log(`[chat] request: messages=${messages.length}`)
      }

      const ollamaUrl = stripTrailingSlashes(process.env.OLLAMA_URL || DEFAULT_OLLAMA_URL)
      const model = process.env.OLLAMA_MODEL || DEFAULT_OLLAMA_MODEL
      const requestId = randomUUID()

      const modelMessages = convertMessagesToModelMessages(messages as any)
      const chatCompletionsMessages = toChatCompletionsMessages(modelMessages)

      const tools = toChatCompletionsTools([
        searchWebDef,
        fetchUrlDef,
        dateTodayDef,
        listUploadsDef,
        getUploadDef,
        ragSearchUploadsDef,
      ])

      const prefixMessages = getPromptPrefixMessagesForModel(model)
      const firstConversation = [...prefixMessages, ...chatCompletionsMessages]

      let firstResponse: Response | null | undefined
      try {
        firstResponse = (await streamOllamaChatCompletionsOnce({
          ollamaUrl,
          model,
          chatCompletionsMessages: firstConversation,
          tools,
          requestId,
          abortSignal: abortController.signal,
        })) as unknown as Response
      } catch (error: unknown) {
        if (abortController.signal.aborted) return
        const message = error instanceof Error ? error.message : 'unknown error'
        if (process.env.NODE_ENV !== 'test') {
          console.error(`[chat] ollama unreachable: ${message}`)
        }
        res.status(502).json({
          error: `Could not reach Ollama at ${ollamaUrl} (is it running?)`,
        })
        return
      }

      if (!firstResponse || !firstResponse.ok) {
        const status = firstResponse?.status || 502
        if (process.env.NODE_ENV !== 'test') {
          console.error(`[chat] ollama error: ${firstResponse?.status} ${firstResponse?.statusText}`)
        }
        res.status(status).json({
          error: `Ollama error: ${firstResponse?.status} ${firstResponse?.statusText}`,
        })
        return
      }

      res.status(200)
      res.setHeader('Content-Type', 'text/event-stream')
      res.setHeader('Cache-Control', 'no-cache, no-transform')
      res.setHeader('Connection', 'keep-alive')
      ;(res as unknown as { flushHeaders?: () => void }).flushHeaders?.()

      res.write(': connected\n\n')

      const stream = streamChatWithTools({
        ollamaUrl,
        model,
        requestId,
        chatCompletionsMessages,
        firstResponse,
        tools,
        serverTools,
        abortSignal: abortController.signal,
      })

      const sseStream = toServerSentEventsStream(stream as unknown as any, abortController)
      const nodeStream = Readable.fromWeb(sseStream as unknown as any)

      nodeStream.on('error', (error: unknown) => {
        if (abortController.signal.aborted) return
        console.error('SSE stream error:', error)
        try {
          res.end()
        } catch {
          // ignore
        }
      })

      res.on('error', (error: unknown) => {
        if (abortController.signal.aborted) return
        console.error('Response error:', error)
        abortController.abort()
        ;(nodeStream as unknown as { destroy: (e: unknown) => void }).destroy(error)
      })

      ;(nodeStream as unknown as { pipe: (r: unknown) => void }).pipe(res)
    } catch (error: unknown) {
      console.error('Chat error:', error)
      const message = error instanceof Error ? error.message : 'Chat error'
      res.status(500).json({ error: message })
    }
  }
}
