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
      nodes.push(
        <code
          key={`c-${nextIndex}`}
          className="border-2 border-black bg-yellow-200 px-1 py-0.5 font-mono text-[0.95em] font-semibold"
        >
          {content}
        </code>,
      )
      i = end + 1
      continue
    }

    nodes.push(text.slice(nextIndex))
    break
  }

  return nodes
}

function normalizeFenceLang(rawLang) {
  const s = String(rawLang ?? '').trim()
  if (!s) return ''
  // Accept things like "json|plaintext|whatever" (docs/examples) by taking the first segment.
  return s.split('|')[0].trim().toLowerCase()
}

function tryPrettyJsonText(text) {
  const s = String(text ?? '').trim()
  if (!s) return ''
  try {
    return JSON.stringify(JSON.parse(s), null, 2)
  } catch {
    return text
  }
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

  for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
    const originalLine = lines[lineIndex]
    const line = originalLine.replace(/\s+$/, '')

    if (!line.trim()) {
      flushParagraph()
      flushList()
      continue
    }

    const trimmed = line.trim()

    // Fenced blocks: ```json ... ```
    if (trimmed.startsWith('```')) {
      flushParagraph()
      flushList()

      const rawLang = trimmed.slice(3).trim()
      const lang = normalizeFenceLang(rawLang)
      const contentLines = []

      // Consume until closing fence or end of text.
      while (lineIndex + 1 < lines.length) {
        const next = String(lines[lineIndex + 1] ?? '')
        if (next.trim().startsWith('```')) {
          lineIndex++
          break
        }
        contentLines.push(next)
        lineIndex++
      }

      blocks.push({
        type: 'fence',
        rawLang,
        lang,
        content: contentLines.join('\n'),
      })
      continue
    }

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
    if (block.type === 'fence') {
      const langLabel = String(block.lang || block.rawLang || 'json').trim() || 'json'
      const normalized = String(block.lang || '').trim()
      const isPlaintext = normalized === 'plaintext' || normalized === 'text' || normalized === 'plain'
      const isJson = normalized === 'json'
      const displayText = isJson ? tryPrettyJsonText(block.content) : String(block.content ?? '')

      return (
        <div
          key={`f-${idx}`}
          className="relative my-2 border-4 border-black bg-white p-3 shadow-brutal-sm"
        >
          <div className="absolute right-2 top-2 select-none border-2 border-black bg-white px-2 py-0.5 text-[9px] font-black uppercase tracking-widest text-black">
            {langLabel}
          </div>

          {isPlaintext ? (
            <div className="brutal-scroll max-h-72 overflow-auto whitespace-pre-wrap border-4 border-black bg-yellow-100 p-3 font-mono text-[11px] leading-5 text-black">
              {displayText || '(empty)'}
            </div>
          ) : (
            <pre className="brutal-scroll max-h-72 overflow-auto whitespace-pre-wrap border-4 border-black bg-yellow-100 p-3 text-[11px] leading-5 text-black">
              <code className="font-mono">{displayText || '(empty)'}</code>
            </pre>
          )}
        </div>
      )
    }

    if (block.type === 'h') {
      return (
        <div key={`h-${idx}`} className="mb-2 mt-2 inline-block border-b-4 border-black bg-yellow-200 px-2 py-1 font-black uppercase tracking-widest">
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
            <span key={`ps-${idx}-${partIndex}`}>
              {renderInline(part)}
              {partIndex < paragraphParts.length - 1 ? <br /> : null}
            </span>
          ))}
        </p>
      )
    }

    return null
  })
}
