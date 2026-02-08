export const STORAGE_KEY = 'robian.chat.messages.v1'
const LEGACY_STORAGE_KEY = 'theapp.chat.messages.v1'

export function loadInitialMessages() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY) || localStorage.getItem(LEGACY_STORAGE_KEY)
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

export function persistMessages(messages) {
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
}

export function clearPersistedMessages() {
  try {
    localStorage.removeItem(STORAGE_KEY)
    localStorage.removeItem(LEGACY_STORAGE_KEY)
  } catch {
    // ignore
  }
}
