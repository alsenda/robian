export function renderMessageText(message) {
  if (!message?.parts?.length) return ''

  return message.parts
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
}
