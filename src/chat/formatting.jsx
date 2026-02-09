function safeHref(rawHref) {
  const href = String(rawHref ?? '').trim()
  if (!href) return null

  const lower = href.toLowerCase()
  if (lower.startsWith('http://') || lower.startsWith('https://')) return href
  if (lower.startsWith('mailto:')) return href
  if (href.startsWith('/') || href.startsWith('#')) return href

  return null
}

/* --------------------------- Inline rendering --------------------------- */

// Finds the *next* token start the same way your old code did (earliest of **, `, [)
const INLINE_START_RE = /(\*\*)|(`)|(\[)/g

function renderInline(text) {
  if (!text) return ''

  const nodes = []
  const s = String(text)
  let i = 0

  const pushText = (from, to) => {
    if (to > from) nodes.push(s.slice(from, to))
  }

  while (i < s.length) {
    INLINE_START_RE.lastIndex = i
    const m = INLINE_START_RE.exec(s)

    if (!m) {
      pushText(i, s.length)
      break
    }

    const start = m.index
    pushText(i, start)

    // **bold**
    if (m[1]) {
      const end = s.indexOf('**', start + 2)
      if (end === -1) {
        nodes.push(s.slice(start))
        break
      }
      nodes.push(<strong key={`b-${start}`}>{s.slice(start + 2, end)}</strong>)
      i = end + 2
      continue
    }

    // `code`
    if (m[2]) {
      const end = s.indexOf('`', start + 1)
      if (end === -1) {
        nodes.push(s.slice(start))
        break
      }
      nodes.push(
        <code
          key={`c-${start}`}
          className="border-2 border-black bg-yellow-200 px-1 py-0.5 font-mono text-[0.95em] font-semibold"
        >
          {s.slice(start + 1, end)}
        </code>,
      )
      i = end + 1
      continue
    }

    // [label] (href) with optional spaces between ] and (
    if (m[3]) {
      const closeBracket = s.indexOf(']', start + 1)
      if (closeBracket === -1) {
        nodes.push(s.slice(start))
        break
      }

      let after = closeBracket + 1
      while (after < s.length && s[after] === ' ') after++

      if (s[after] !== '(') {
        nodes.push('[')
        i = start + 1
        continue
      }

      const closeParen = s.indexOf(')', after + 1)
      if (closeParen === -1) {
        nodes.push(s.slice(start))
        break
      }

      const label = s.slice(start + 1, closeBracket)
      const hrefRaw = s.slice(after + 1, closeParen)
      const href = safeHref(hrefRaw)

      if (!href) {
        nodes.push(s.slice(start, closeParen + 1))
        i = closeParen + 1
        continue
      }

      const isInternal = href.startsWith('#') || href.startsWith('/')
      nodes.push(
        <a
          key={`a-${start}`}
          href={href}
          target={isInternal ? undefined : '_blank'}
          rel={isInternal ? undefined : 'noreferrer noopener'}
          className="font-semibold underline underline-offset-2"
        >
          {label || href}
        </a>,
      )
      i = closeParen + 1
      continue
    }

    nodes.push(s.slice(start))
    break
  }

  return nodes
}

/* --------------------------- Fence helpers --------------------------- */

function normalizeFenceLang(rawLang) {
  const s = String(rawLang ?? '').trim()
  if (!s) return ''
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

/* --------------------------- Block parsing --------------------------- */

const RX = {
  fence: /^```(.*)$/,
  heading: /^(.+):\s*$/,
  bullet: /^([*\-+])\s+(.*)$/,
  ordered: /^(\d+)\.\s+(.*)$/,
}

export function renderFormattedText(rawText) {
  const text = (rawText ?? '').replace(/\r\n/g, '\n')
  if (!text) return ''

  const lines = text.split('\n')
  const blocks = []

  let paragraphLines = []
  let listBlock = null

  const flushParagraph = () => {
    if (!paragraphLines.length) return
    const paragraphText = paragraphLines.join('\n').trim()
    if (paragraphText) blocks.push({ type: 'p', text: paragraphText })
    paragraphLines = []
  }

  const flushList = () => {
    if (!listBlock?.items?.length) {
      listBlock = null
      return
    }
    blocks.push({ type: 'list', kind: listBlock.kind, items: listBlock.items })
    listBlock = null
  }

  const ensureList = (kind) => {
    if (!listBlock || listBlock.kind !== kind) {
      flushList()
      listBlock = { kind, items: [] }
    }
  }

  const pushUl = (marker, content) => {
    ensureList('ul')
    if (marker === '+' && listBlock.items.length > 0) {
      const last = listBlock.items[listBlock.items.length - 1]
      ;(last.children ??= []).push(content)
    } else {
      listBlock.items.push({ text: content })
    }
  }

  const pushOl = (content) => {
    ensureList('ol')
    listBlock.items.push({ text: content })
  }

  const isHeading = (trimmed, match) =>
    !!match && trimmed.length <= 64 && !trimmed.startsWith('http') && !trimmed.includes('.')

  for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
    const line = String(lines[lineIndex] ?? '').replace(/\s+$/, '')
    if (!line.trim()) {
      flushParagraph()
      flushList()
      continue
    }

    const trimmed = line.trim()

    // Fenced blocks: ```json ... ```
    const fence = trimmed.match(RX.fence)
    if (fence) {
      flushParagraph()
      flushList()

      const rawLang = (fence[1] ?? '').trim()
      const lang = normalizeFenceLang(rawLang)
      const contentLines = []

      while (lineIndex + 1 < lines.length) {
        const next = String(lines[lineIndex + 1] ?? '')
        if (RX.fence.test(next.trim())) {
          lineIndex++
          break
        }
        contentLines.push(next)
        lineIndex++
      }

      blocks.push({ type: 'fence', rawLang, lang, content: contentLines.join('\n') })
      continue
    }

    const headingMatch = trimmed.match(RX.heading)
    if (isHeading(trimmed, headingMatch)) {
      flushParagraph()
      flushList()
      blocks.push({ type: 'h', text: headingMatch[1] })
      continue
    }

    const bulletMatch = trimmed.match(RX.bullet)
    if (bulletMatch) {
      flushParagraph()
      pushUl(bulletMatch[1], bulletMatch[2])
      continue
    }

    const orderedMatch = trimmed.match(RX.ordered)
    if (orderedMatch) {
      flushParagraph()
      pushOl(orderedMatch[2])
      continue
    }

    flushList()
    paragraphLines.push(line)
  }

  flushParagraph()
  flushList()

  const isInternalHref = (href) => href.startsWith('#') || href.startsWith('/')

  return blocks.map((block, idx) => {
    if (block.type === 'fence') {
      const langLabel = String(block.lang || block.rawLang || 'json').trim() || 'json'
      const normalized = String(block.lang || '').trim()
      const isPlaintext = normalized === 'plaintext' || normalized === 'text' || normalized === 'plain'
      const isJson = normalized === 'json'
      const displayText = isJson ? tryPrettyJsonText(block.content) : String(block.content ?? '')

      return (
        <div key={`f-${idx}`} className="relative my-2 border-4 border-black bg-white p-3 shadow-brutal-sm">
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
        <div
          key={`h-${idx}`}
          className="mb-2 mt-2 inline-block border-b-4 border-black bg-yellow-200 px-2 py-1 font-black uppercase tracking-widest"
        >
          {renderInline(block.text)}
        </div>
      )
    }

    if (block.type === 'list') {
      const ListTag = block.kind === 'ol' ? 'ol' : 'ul'
      const listClass = block.kind === 'ol' ? 'my-2 list-decimal pl-6' : 'my-2 list-disc pl-6'

      return (
        <ListTag key={`l-${idx}`} className={listClass}>
          {block.items.map((item, itemIndex) => (
            <li key={`li-${idx}-${itemIndex}`}>
              {renderInline(item.text)}
              {item.children?.length ? (
                <ul className="mt-1 list-disc pl-6">
                  {item.children.map((child, childIndex) => (
                    <li key={`li-${idx}-${itemIndex}-${childIndex}`}>
                      {renderInline(child)}
                    </li>
                  ))}
                </ul>
              ) : null}
            </li>
          ))}
        </ListTag>
      )
    }

    if (block.type === 'p') {
      const parts = block.text.split('\n')
      return (
        <p key={`p-${idx}`}>
          {parts.map((part, partIndex) => (
            <span key={`ps-${idx}-${partIndex}`}>
              {renderInline(part)}
              {partIndex < parts.length - 1 ? <br /> : null}
            </span>
          ))}
        </p>
      )
    }

    return null
  })
}
