import { useChat } from '@tanstack/ai-react'
import { sseConnectionAdapter } from '@tanstack/ai-client'
import './App.css'

function App() {
  const { messages, input, setInput, handleSubmit, isLoading } = useChat({
    connectionAdapter: sseConnectionAdapter({
      url: 'http://localhost:3001/api/chat',
    }),
  })

  return (
    <div className="chat-container">
      <div className="chat-header">
        <h1>AI Chat</h1>
      </div>
      
      <div className="chat-messages">
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
              {message.content}
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

      <form onSubmit={handleSubmit} className="chat-input">
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
