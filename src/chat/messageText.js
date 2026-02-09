function stripBadgesBlock(rawText) {
  const text = String(rawText ?? '')
  if (!text) return ''

  const start = /^BADGES:\s*$/m
  const end = /^END_BADGES\s*$/m

  if (!start.test(text)) return text

  const lines = text.split(/\r?\n/g)
  const out = []
  let skipping = false

  for (const line of lines) {
    const trimmed = String(line).trim()
    if (!skipping && trimmed === 'BADGES:') {
      skipping = true
      continue
    }
    if (skipping && trimmed === 'END_BADGES') {
      skipping = false
      continue
    }
    if (!skipping) out.push(line)
  }

  // If END_BADGES was missing, we intentionally drop everything after BADGES:.
  const cleaned = out.join('\n')
  return cleaned.replace(/\n{3,}/g, '\n\n').trimEnd()
}

export function renderMessageText(message) {
  if (!message?.parts?.length) return ''

  const text = message.parts
    .map((part) => {
      if (part.type === 'text') return part.content
      if (part.type === 'thinking') return part.content
      // Tool details are shown in the ToolBadges UI.
      if (part.type === 'tool-call') return ''
      if (part.type === 'tool-result') return ''
      return ''
    })
    .filter(Boolean)
    .join('')

  return stripBadgesBlock(text)
}
