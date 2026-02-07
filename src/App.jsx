import { useChat } from '@tanstack/ai-react'
import { fetchServerSentEvents } from '@tanstack/ai-client'
import { useEffect, useMemo, useRef, useState } from 'react'
import './App.css'

import { ChatHeader } from './chat/components/ChatHeader.jsx'
import { ChatInput } from './chat/components/ChatInput.jsx'
import { ChatMessages } from './chat/components/ChatMessages.jsx'
import {
  clearPersistedMessages,
  loadInitialMessages,
  persistMessages,
} from './chat/storage.js'
import { useAutoScroll } from './chat/useAutoScroll.js'

function App() {
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

  const { messagesViewportRef, bottomRef, scrollToBottom } = useAutoScroll({
    messages,
    isLoading,
  })

  useEffect(() => {
    const raf = requestAnimationFrame(() => inputRef.current?.focus())
    return () => cancelAnimationFrame(raf)
  }, [])

  useEffect(() => {
    try {
      persistMessages(messages)
    } catch {
      // ignore storage errors (quota/private mode)
    }
  }, [messages])

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

    clearPersistedMessages()

    requestAnimationFrame(() => inputRef.current?.focus())
  }

  return (
    <div className="chat-shell">
      <div className="chat-panel" role="application" aria-label="AI chat">
        <ChatHeader onRestart={onRestart} />

        <ChatMessages
          messages={messages}
          isLoading={isLoading}
          error={error}
          messagesViewportRef={messagesViewportRef}
          bottomRef={bottomRef}
        />

        <ChatInput
          inputRef={inputRef}
          input={input}
          setInput={setInput}
          onSubmit={onSubmit}
          isLoading={isLoading}
        />
      </div>
    </div>
  )
}

export default App
