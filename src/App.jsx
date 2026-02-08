import { useChat } from '@tanstack/ai-react'
import { fetchServerSentEvents } from '@tanstack/ai-client'
import { useEffect, useMemo, useRef, useState } from 'react'

import { ChatHeader } from './chat/components/ChatHeader.jsx'
import { ChatInput } from './chat/components/ChatInput.jsx'
import { ChatMessages } from './chat/components/ChatMessages.jsx'
import { UploadsPage } from './uploads/UploadsPage.jsx'
import {
  clearPersistedMessages,
  loadInitialMessages,
  persistMessages,
} from './chat/storage.js'
import { useAutoScroll } from './chat/useAutoScroll.js'

function App() {
  const [initialMessages] = useState(loadInitialMessages)
  const [view, setView] = useState('chat')

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
    if (view !== 'chat') return
    const raf = requestAnimationFrame(() => scrollToBottom('auto'))
    return () => cancelAnimationFrame(raf)
  }, [view, scrollToBottom])

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

    // Mirror the same rAF + auto scroll used for streaming AI updates.
    requestAnimationFrame(() => scrollToBottom('auto'))

    // Keep focus in the input so you can immediately type again
    requestAnimationFrame(() => inputRef.current?.focus())
    await sendMessage(content)
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
    <div className="fixed inset-0 z-10 bg-violet-100">
      <div
        className="relative flex h-full w-full items-center justify-center p-6"
        role="application"
        aria-label="AI chat"
      >
        <div className="flex h-full w-full max-w-5xl flex-col overflow-hidden border-4 border-black bg-white shadow-brutal">
          <ChatHeader onRestart={onRestart} view={view} onNavigate={setView} />

          {view === 'uploads' ? (
            <UploadsPage />
          ) : (
            <>
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
            </>
          )}
        </div>
      </div>
    </div>
  )
}

export default App
