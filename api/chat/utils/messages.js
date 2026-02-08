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

// Converts TanStack AI model messages into the Chat Completions wire format
// expected by Ollama's `/v1/chat/completions` endpoint.
export function toChatCompletionsMessages(modelMessages) {
  return modelMessages
    .map((msg) => ({
      role: msg.role,
      content: getTextContent(msg.content),
    }))
    .filter((m) => typeof m.content === 'string' && m.content.length > 0)
}
