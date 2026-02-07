export function renderMessageText(message) {
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
