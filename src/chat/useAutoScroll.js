import { useEffect, useRef } from 'react'

export function useAutoScroll({ messages, isLoading }) {
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
    if (!shouldAutoScroll()) return

    const raf = requestAnimationFrame(() => scrollToBottom('auto'))
    return () => cancelAnimationFrame(raf)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [messages, isLoading])

  return { messagesViewportRef, bottomRef, scrollToBottom }
}
