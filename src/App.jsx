import { useChat } from '@tanstack/ai-react'
import { fetchServerSentEvents } from '@tanstack/ai-client'
import { useEffect, useMemo, useRef, useState } from 'react'
import './App.css'

function App() {
  const [isOpen, setIsOpen] = useState(false)
  const connection = useMemo(
    () => fetchServerSentEvents('/api/chat'),
    [],
  )

  const { messages, sendMessage, isLoading, error } = useChat({
    id: 'main-chat',
    connection,
  })

  const [input, setInput] = useState('')

  const messagesViewportRef = useRef(null)
  const bottomRef = useRef(null)

  const scrollToBottom = (behavior = 'smooth') => {
    bottomRef.current?.scrollIntoView({ behavior, block: 'end' })
  }

  const shouldAutoScroll = () => {
    const viewport = messagesViewportRef.current
    if (!viewport) return true

    const distanceFromBottom =
      viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight
    return distanceFromBottom < 120
  }

  useEffect(() => {
    if (!isOpen) return
    if (!shouldAutoScroll()) return

    const raf = requestAnimationFrame(() => scrollToBottom('auto'))
    return () => cancelAnimationFrame(raf)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, messages, isLoading])

  const onSubmit = async (e) => {
    e.preventDefault()
    const content = input.trim()
    if (!content || isLoading) return

    setInput('')
    await sendMessage(content)

    if (isOpen) {
      scrollToBottom('smooth')
    }
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
    <div className="chat-shell">
      {!isOpen && (
        <button
          type="button"
          className="chat-trigger"
          onClick={() => setIsOpen(true)}
          aria-label="Open chat"
        >
          Chat
        </button>
      )}

      {isOpen && (
        <div className="chat-panel" role="dialog" aria-label="AI chat">
          <div className="chat-header">
            <div className="chat-title">AI Chat</div>
            <button
              type="button"
              className="chat-close"
              onClick={() => setIsOpen(false)}
              aria-label="Close chat"
            >
              Close
            </button>
          </div>

          <div className="chat-messages" ref={messagesViewportRef}>
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
                  {message.role === 'user' ? 'You' : 'AI'}
                </div>
                <div className="message-content">{renderMessageText(message)}</div>
              </div>
            ))}
            {isLoading && (
              <div className="message assistant">
                <div className="message-role">AI</div>
                <div className="message-content typing">Thinking…</div>
              </div>
            )}
            <div ref={bottomRef} />
          </div>

          <form onSubmit={onSubmit} className="chat-input">
            <input
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Message…"
              disabled={isLoading}
            />
            <button type="submit" disabled={isLoading || !input.trim()}>
              Send
            </button>
          </form>
        </div>
      )}
    </div>
  )
}

export default App
