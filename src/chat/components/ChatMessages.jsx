import { renderFormattedText } from '../formatting.jsx'
import { renderMessageText } from '../messageText.js'

export function ChatMessages({ messages, isLoading, error, messagesViewportRef, bottomRef }) {
  return (
    <div className="chat-messages" ref={messagesViewportRef}>
      {error && (
        <div className="message assistant">
          <div className="message-role">⚠️ Error</div>
          <div className="message-content">{error.message}</div>
        </div>
      )}
      {messages.length === 0 && (
        <div className="empty-state">
          <p>Start a conversation.</p>
        </div>
      )}
      {messages.map((message, index) => (
        <div key={index} className={`message ${message.role}`}>
          <div className="message-role">{message.role === 'user' ? 'You' : 'AI'}</div>
          <div className="message-content">
            {(() => {
              const text = renderMessageText(message)
              const isLast = index === messages.length - 1
              if (!text && isLoading && isLast && message.role === 'assistant') {
                return <span className="typing">Thinking…</span>
              }
              return renderFormattedText(text)
            })()}
          </div>
        </div>
      ))}
      <div ref={bottomRef} />
    </div>
  )
}
