import { chat } from '@tanstack/ai'
import { openaiText } from '@tanstack/ai-openai'

/**
 * API endpoint for chat
 * This should be integrated with your backend server (Express, etc.)
 * 
 * Example usage with Express:
 * app.post('/api/chat', handleChat)
 */
export async function handleChat(req, res) {
  const { messages } = req.body

  // Set OPENAI_API_KEY in your environment variables
  const apiKey = process.env.OPENAI_API_KEY
  
  if (!apiKey) {
    return res.status(500).json({ 
      error: 'OPENAI_API_KEY not configured' 
    })
  }

  try {
    const stream = await chat({
      adapter: openaiText('gpt-4o-mini', {
        apiKey,
      }),
      messages,
    })

    // Set headers for SSE streaming
    res.setHeader('Content-Type', 'text/event-stream')
    res.setHeader('Cache-Control', 'no-cache')
    res.setHeader('Connection', 'keep-alive')

    // Stream the response
    for await (const chunk of stream) {
      res.write(`data: ${JSON.stringify(chunk)}\n\n`)
    }

    res.end()
  } catch (error) {
    console.error('Chat error:', error)
    res.status(500).json({ error: error.message })
  }
}
