import { chat, convertMessagesToModelMessages, toServerSentEventsStream } from '@tanstack/ai'
import { openai } from '@tanstack/ai-openai'
import { Readable } from 'node:stream'

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

  // openai() auto-detects OPENAI_API_KEY from process.env
  if (!process.env.OPENAI_API_KEY) {
    return res.status(500).json({ error: 'OPENAI_API_KEY not configured' })
  }

  try {
    const abortController = new AbortController()
    // Abort when the client disconnects (SSE response closes)
    res.on('close', () => abortController.abort())
    req.on('aborted', () => abortController.abort())

    if (process.env.NODE_ENV !== 'test') {
      console.log(`[chat] request: messages=${messages.length}`)
    }

    const model = process.env.OPENAI_MODEL || 'gpt-4o-mini'

    const stream = chat({
      adapter: openai(),
      model,
      messages: convertMessagesToModelMessages(messages),
      abortController,
    })

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
