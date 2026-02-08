export function getTextContent(content) {
  if (content == null) return ''
  if (typeof content === 'string') return content
  if (Array.isArray(content)) {
    return content
      .filter((part) => part && part.type === 'text')
      .map((part) => part.content)
      .join('')
  }
  return String(content)
}

export function toOpenAiMessages(modelMessages) {
  return modelMessages
    .map((msg) => ({
      role: msg.role,
      content: getTextContent(msg.content),
    }))
    .filter((m) => typeof m.content === 'string' && m.content.length > 0)
}
