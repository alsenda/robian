import { useChat } from '@tanstack/ai-react'
import { fetchServerSentEvents } from '@tanstack/ai-client'
import { useEffect, useMemo, useRef, useState } from 'react'

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
    const focusInput = () => {
      const el = inputRef.current
      if (!el) return
      if (document.activeElement === el) return
      try {
        el.focus({ preventScroll: true })
      } catch {
        try {
          el.focus()
        } catch {
          // ignore
        }
      }
    }

    const onPointerUpCapture = () => {
      requestAnimationFrame(focusInput)
    }

    const onKeyDownCapture = (e) => {
      // Avoid breaking common shortcuts (copy/paste, etc.)
      if (e.ctrlKey || e.metaKey || e.altKey) return
      requestAnimationFrame(focusInput)
    }

    window.addEventListener('pointerup', onPointerUpCapture, true)
    window.addEventListener('keydown', onKeyDownCapture, true)

    return () => {
      window.removeEventListener('pointerup', onPointerUpCapture, true)
      window.removeEventListener('keydown', onKeyDownCapture, true)
    }
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
    <div className="fixed inset-0 z-10 bg-yellow-300">
      <div
        className="relative flex h-full w-full items-center justify-center p-6"
        role="application"
        aria-label="AI chat"
      >
        <div className="flex h-full w-full max-w-5xl flex-col overflow-hidden border-4 border-black bg-white shadow-2xl shadow-black/40">
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
    </div>
  )
}

export default App
