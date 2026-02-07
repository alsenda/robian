import { Fragment } from 'react'

function renderInline(text) {
  if (!text) return ''

  const nodes = []
  let i = 0
  while (i < text.length) {
    const boldIndex = text.indexOf('**', i)
    const codeIndex = text.indexOf('`', i)
    let nextIndex = -1
    let token = null

    if (boldIndex !== -1 && (codeIndex === -1 || boldIndex < codeIndex)) {
      nextIndex = boldIndex
      token = 'bold'
    } else if (codeIndex !== -1) {
      nextIndex = codeIndex
      token = 'code'
    }

    if (nextIndex === -1) {
      nodes.push(text.slice(i))
      break
    }

    if (nextIndex > i) nodes.push(text.slice(i, nextIndex))

    if (token === 'bold') {
      const end = text.indexOf('**', nextIndex + 2)
      if (end === -1) {
        nodes.push(text.slice(nextIndex))
        break
      }
      const content = text.slice(nextIndex + 2, end)
      nodes.push(<strong key={`b-${nextIndex}`}>{content}</strong>)
      i = end + 2
      continue
    }

    if (token === 'code') {
      const end = text.indexOf('`', nextIndex + 1)
      if (end === -1) {
        nodes.push(text.slice(nextIndex))
        break
      }
      const content = text.slice(nextIndex + 1, end)
      nodes.push(<code key={`c-${nextIndex}`}>{content}</code>)
      i = end + 1
      continue
    }

    nodes.push(text.slice(nextIndex))
    break
  }

  return nodes
}

export function renderFormattedText(rawText) {
  const text = (rawText ?? '').replace(/\r\n/g, '\n')
  if (!text) return ''

  const lines = text.split('\n')
  const blocks = []

  let paragraphLines = []
  let listItems = null

  const flushParagraph = () => {
    if (!paragraphLines.length) return
    const paragraphText = paragraphLines.join('\n').trim()
    if (paragraphText) blocks.push({ type: 'p', text: paragraphText })
    paragraphLines = []
  }

  const flushList = () => {
    if (!listItems || !listItems.length) {
      listItems = null
      return
    }
    blocks.push({ type: 'list', items: listItems })
    listItems = null
  }

  for (const originalLine of lines) {
    const line = originalLine.replace(/\s+$/, '')

    if (!line.trim()) {
      flushParagraph()
      flushList()
      continue
    }

    const trimmed = line.trim()
    const headingMatch = trimmed.match(/^(.+):\s*$/)
    const bulletMatch = trimmed.match(/^([*\-+])\s+(.*)$/)

    const isHeading =
      !!headingMatch &&
      trimmed.length <= 64 &&
      !trimmed.startsWith('http') &&
      !trimmed.includes('.')

    if (isHeading) {
      flushParagraph()
      flushList()
      blocks.push({ type: 'h', text: headingMatch[1] })
      continue
    }

    if (bulletMatch) {
      flushParagraph()
      const marker = bulletMatch[1]
      const content = bulletMatch[2]

      if (!listItems) listItems = []

      if (marker === '+' && listItems.length > 0) {
        const last = listItems[listItems.length - 1]
        if (!last.children) last.children = []
        last.children.push(content)
      } else {
        listItems.push({ text: content })
      }

      continue
    }

    flushList()
    paragraphLines.push(line)
  }

  flushParagraph()
  flushList()

  return blocks.map((block, idx) => {
    if (block.type === 'h') {
      return (
        <div key={`h-${idx}`} className="message-heading">
          {renderInline(block.text)}
        </div>
      )
    }

    if (block.type === 'list') {
      return (
        <ul key={`l-${idx}`}>
          {block.items.map((item, itemIndex) => (
            <li key={`li-${idx}-${itemIndex}`}>
              {renderInline(item.text)}
              {item.children?.length ? (
                <ul>
                  {item.children.map((child, childIndex) => (
                    <li key={`li-${idx}-${itemIndex}-${childIndex}`}>
                      {renderInline(child)}
                    </li>
                  ))}
                </ul>
              ) : null}
            </li>
          ))}
        </ul>
      )
    }

    if (block.type === 'p') {
      const paragraphParts = block.text.split('\n')
      return (
        <p key={`p-${idx}`}>
          {paragraphParts.map((part, partIndex) => (
            <Fragment key={`ps-${idx}-${partIndex}`}>
              {renderInline(part)}
              {partIndex < paragraphParts.length - 1 ? <br /> : null}
            </Fragment>
          ))}
        </p>
      )
    }

    return null
  })
}
