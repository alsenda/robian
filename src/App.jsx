import { useChat } from '@tanstack/ai-react'
import { fetchServerSentEvents } from '@tanstack/ai-client'
import { useEffect, useMemo, useRef, useState } from 'react'
import './App.css'

function App() {
  const STORAGE_KEY = 'theapp.chat.messages.v1'

  const loadInitialMessages = () => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY)
      if (!raw) return []
      const parsed = JSON.parse(raw)
      if (!Array.isArray(parsed)) return []

      return parsed
        .map((m) => {
          if (!m || typeof m !== 'object') return null
          if (m.role !== 'user' && m.role !== 'assistant') return null
          if (!Array.isArray(m.parts)) return null
          return {
            id: typeof m.id === 'string' ? m.id : undefined,
            role: m.role,
            parts: m.parts,
            createdAt: m.createdAt ? new Date(m.createdAt) : new Date(),
          }
        })
        .filter(Boolean)
    } catch {
      return []
    }
  }

  const [initialMessages] = useState(loadInitialMessages)

  const connection = useMemo(
    () => fetchServerSentEvents('/api/chat'),
    [],
  )

  const { messages, sendMessage, isLoading, error } = useChat({
    id: 'main-chat',
    connection,
    initialMessages,
  })

  const [input, setInput] = useState('')
  const inputRef = useRef(null)

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
    const raf = requestAnimationFrame(() => inputRef.current?.focus())
    return () => cancelAnimationFrame(raf)
  }, [])

  useEffect(() => {
    try {
      const serializable = messages.map((m) => ({
        id: m.id,
        role: m.role,
        parts: m.parts,
        createdAt:
          m.createdAt instanceof Date
            ? m.createdAt.toISOString()
            : new Date().toISOString(),
      }))
      localStorage.setItem(STORAGE_KEY, JSON.stringify(serializable))
    } catch {
      // ignore storage errors (quota/private mode)
    }
  }, [messages])

  useEffect(() => {
    if (!shouldAutoScroll()) return

    const raf = requestAnimationFrame(() => scrollToBottom('auto'))
    return () => cancelAnimationFrame(raf)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [messages, isLoading])

  const onSubmit = async (e) => {
    e.preventDefault()
    const content = input.trim()
    if (!content || isLoading) return

    setInput('')

    // Keep focus in the input so you can immediately type again
    requestAnimationFrame(() => inputRef.current?.focus())
    await sendMessage(content)

    scrollToBottom('smooth')
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
      <div className="chat-panel" role="application" aria-label="AI chat">
        <header className="chat-header">
          <div className="chat-brand">DIGITAL CHAT</div>
          <nav className="chat-nav" aria-label="Primary">
            <a className="chat-nav-link" href="#home" onClick={(e) => e.preventDefault()}>
              HOME
            </a>
            <a className="chat-nav-link" href="#cases" onClick={(e) => e.preventDefault()}>
              CASES
            </a>
            <a className="chat-nav-link" href="#about" onClick={(e) => e.preventDefault()}>
              ABOUT
            </a>
          </nav>
        </header>

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
              <div className="message-role">
                {message.role === 'user' ? 'You' : 'AI'}
              </div>
              <div className="message-content">
                {(() => {
                  const text = renderMessageText(message)
                  const isLast = index === messages.length - 1
                  if (!text && isLoading && isLast && message.role === 'assistant') {
                    return <span className="typing">Thinking…</span>
                  }
                  return text
                })()}
              </div>
            </div>
          ))}
          <div ref={bottomRef} />
        </div>

        <form onSubmit={onSubmit} className="chat-input">
          <input
            ref={inputRef}
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Message…"
          />
          <button type="submit" disabled={isLoading || !input.trim()}>
            Send
          </button>
        </form>
      </div>
    </div>
  )
}

export default App
