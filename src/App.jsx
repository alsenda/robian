import { useChat } from '@tanstack/ai-react'
import { fetchServerSentEvents } from '@tanstack/ai-client'
import { useMemo, useState } from 'react'
import './App.css'

function App() {
  const connection = useMemo(
    () => fetchServerSentEvents('/api/chat'),
    [],
  )

  const { messages, sendMessage, isLoading, error } = useChat({
    id: 'main-chat',
    connection,
  })

  const [input, setInput] = useState('')

  const onSubmit = async (e) => {
    e.preventDefault()
    const content = input.trim()
    if (!content || isLoading) return

    setInput('')
    await sendMessage(content)
  }

  const renderMessageText = (message) => {
    if (!message?.parts?.length) return ''

    return message.parts
      .map((part) => {
        if (part.type === 'text') return part.content
        if (part.type === 'thinking') return part.content
        if (part.type === 'tool-call') return `[Tool: ${part.name}]`
        if (part.type === 'tool-result') return part.content
        return ''
      })
      .filter(Boolean)
      .join('')
  }

  return (
    <div className="chat-container">
      <div className="chat-header">
        <h1>AI Chat</h1>
      </div>
      
      <div className="chat-messages">
        {error && (
          <div className="message assistant">
            <div className="message-role">⚠️ Error</div>
            <div className="message-content">{error.message}</div>
          </div>
        )}
        {messages.length === 0 && (
          <div className="empty-state">
            <p>Start a conversation with AI</p>
          </div>
        )}
        {messages.map((message, index) => (
          <div key={index} className={`message ${message.role}`}>
            <div className="message-role">
              {message.role === 'user' ? '👤 You' : '🤖 AI'}
            </div>
            <div className="message-content">
              {renderMessageText(message)}
            </div>
          </div>
        ))}
        {isLoading && (
          <div className="message assistant">
            <div className="message-role">🤖 AI</div>
            <div className="message-content typing">Thinking...</div>
          </div>
        )}
      </div>

      <form onSubmit={onSubmit} className="chat-input">
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Type your message..."
          disabled={isLoading}
        />
        <button type="submit" disabled={isLoading || !input.trim()}>
          Send
        </button>
      </form>
    </div>
  )
}

export default App
