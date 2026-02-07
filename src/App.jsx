import { useChat } from '@tanstack/ai-react'
import { fetchServerSentEvents } from '@tanstack/ai-client'
import { useEffect, useMemo, useRef, useState } from 'react'
import './App.css'

function App() {
  const STORAGE_KEY = 'theapp.chat.messages.v1'

  const renderInline = (text) => {
    if (!text) return ''

    const nodes = []
    let i = 0
    while (i < text.length) {
      const boldIndex = text.indexOf('**', i)
      const codeIndex = text.indexOf('`', i)
      let nextIndex = -1
      let token = null

      if (boldIndex !== -1 && (codeIndex === -1 || boldIndex < codeIndex)) {
        nextIndex = boldIndex
        token = 'bold'
      } else if (codeIndex !== -1) {
        nextIndex = codeIndex
        token = 'code'
      }

      if (nextIndex === -1) {
        nodes.push(text.slice(i))
        break
      }

      if (nextIndex > i) nodes.push(text.slice(i, nextIndex))

      if (token === 'bold') {
        const end = text.indexOf('**', nextIndex + 2)
        if (end === -1) {
          nodes.push(text.slice(nextIndex))
          break
        }
        const content = text.slice(nextIndex + 2, end)
        nodes.push(<strong key={`b-${nextIndex}`}>{content}</strong>)
        i = end + 2
        continue
      }

      if (token === 'code') {
        const end = text.indexOf('`', nextIndex + 1)
        if (end === -1) {
          nodes.push(text.slice(nextIndex))
          break
        }
        const content = text.slice(nextIndex + 1, end)
        nodes.push(<code key={`c-${nextIndex}`}>{content}</code>)
        i = end + 1
        continue
      }

      nodes.push(text.slice(nextIndex))
      break
    }

    return nodes
  }

  const renderFormattedText = (rawText) => {
    const text = (rawText ?? '').replace(/\r\n/g, '\n')
    if (!text) return ''

    const lines = text.split('\n')
    const blocks = []

    let paragraphLines = []
    let listItems = null

    const flushParagraph = () => {
      if (!paragraphLines.length) return
      const paragraphText = paragraphLines.join('\n').trim()
      if (paragraphText) blocks.push({ type: 'p', text: paragraphText })
      paragraphLines = []
    }

    const flushList = () => {
      if (!listItems || !listItems.length) {
        listItems = null
        return
      }
      blocks.push({ type: 'list', items: listItems })
      listItems = null
    }

    for (const originalLine of lines) {
      const line = originalLine.replace(/\s+$/, '')

      if (!line.trim()) {
        flushParagraph()
        flushList()
        continue
      }

      const trimmed = line.trim()
      const headingMatch = trimmed.match(/^(.+):\s*$/)
      const bulletMatch = trimmed.match(/^([*\-+])\s+(.*)$/)

      const isHeading =
        !!headingMatch &&
        trimmed.length <= 64 &&
        !trimmed.startsWith('http') &&
        !trimmed.includes('.')

      if (isHeading) {
        flushParagraph()
        flushList()
        blocks.push({ type: 'h', text: headingMatch[1] })
        continue
      }

      if (bulletMatch) {
        flushParagraph()
        const marker = bulletMatch[1]
        const content = bulletMatch[2]

        if (!listItems) listItems = []

        if (marker === '+' && listItems.length > 0) {
          const last = listItems[listItems.length - 1]
          if (!last.children) last.children = []
          last.children.push(content)
        } else {
          listItems.push({ text: content })
        }

        continue
      }

      flushList()
      paragraphLines.push(line)
    }

    flushParagraph()
    flushList()

    return blocks.map((block, idx) => {
      if (block.type === 'h') {
        return (
          <div key={`h-${idx}`} className="message-heading">
            {renderInline(block.text)}
          </div>
        )
      }

      if (block.type === 'list') {
        return (
          <ul key={`l-${idx}`}>
            {block.items.map((item, itemIndex) => (
              <li key={`li-${idx}-${itemIndex}`}>
                {renderInline(item.text)}
                {item.children?.length ? (
                  <ul>
                    {item.children.map((child, childIndex) => (
                      <li key={`li-${idx}-${itemIndex}-${childIndex}`}>
                        {renderInline(child)}
                      </li>
                    ))}
                  </ul>
                ) : null}
              </li>
            ))}
          </ul>
        )
      }

      if (block.type === 'p') {
        const paragraphParts = block.text.split('\n')
        return (
          <p key={`p-${idx}`}>
            {paragraphParts.map((part, partIndex) => (
              <span key={`ps-${idx}-${partIndex}`}>
                {renderInline(part)}
                {partIndex < paragraphParts.length - 1 ? <br /> : null}
              </span>
            ))}
          </p>
        )
      }

      return null
    })
  }

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

  const { messages, sendMessage, isLoading, error, clear, stop } = useChat({
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

  const onRestart = () => {
    try {
      stop()
    } catch {
      // ignore
    }

    clear()

    try {
      localStorage.removeItem(STORAGE_KEY)
    } catch {
      // ignore
    }

    requestAnimationFrame(() => inputRef.current?.focus())
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
            <button type="button" className="chat-action" onClick={onRestart}>
              RESTART
            </button>
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
                  return renderFormattedText(text)
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
