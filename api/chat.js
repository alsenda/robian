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
    req.on('close', () => abortController.abort())

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

    // Send SSE stream
    const sseStream = toServerSentEventsStream(stream, abortController)
    Readable.fromWeb(sseStream).pipe(res)
  } catch (error) {
    console.error('Chat error:', error)
    res.status(500).json({ error: error.message })
  }
}
