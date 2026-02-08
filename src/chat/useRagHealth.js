import { useEffect, useState } from 'react'

export function useRagHealth() {
  const [loading, setLoading] = useState(true)
  const [data, setData] = useState(null)
  const [error, setError] = useState(null)

  useEffect(() => {
    let alive = true

    ;(async () => {
      try {
        setLoading(true)
        const resp = await fetch('/api/rag/health', { method: 'GET' })
        const json = await resp.json().catch(() => null)
        if (!alive) return
        if (!resp.ok) {
          setError(new Error('Failed to load RAG health'))
          setData(null)
          return
        }
        setData(json)
        setError(null)
      } catch (e) {
        if (!alive) return
        const err = e instanceof Error ? e : new Error('Failed to load RAG health')
        setError(err)
        setData(null)
      } finally {
        if (!alive) return
        setLoading(false)
      }
    })()

    return () => {
      alive = false
    }
  }, [])

  return { loading, data, error }
}
