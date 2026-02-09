function tryPrettyJson(value) {
  if (value == null) return ''
  if (typeof value === 'string') {
    const s = value.trim()
    if (!s) return ''
    try {
      return JSON.stringify(JSON.parse(s), null, 2)
    } catch {
      return value
    }
  }
  try {
    return JSON.stringify(value, null, 2)
  } catch {
    return String(value)
  }
}

function isToolCallPart(part) {
  const t = part?.type
  return t === 'tool-call' || t === 'tool_call'
}

function isToolResultPart(part) {
  const t = part?.type
  return t === 'tool-result' || t === 'tool_result'
}

function getToolCallId(part) {
  return (
    part?.toolCallId ||
    part?.tool_call_id ||
    part?.id ||
    part?.toolCall?.id ||
    part?.toolCall?.toolCallId
  )
}

function getToolName(part) {
  return (
    part?.name ||
    part?.toolName ||
    part?.toolCall?.function?.name ||
    part?.toolCall?.name ||
    'tool'
  )
}

function getToolPayload(part) {
  const payload =
    part?.payload ??
    part?.input ??
    part?.args ??
    part?.arguments ??
    part?.toolCall?.function?.arguments ??
    part?.toolCall?.arguments
  return payload
}

function collectToolRunsFromParts(parts) {
  const safeParts = Array.isArray(parts) ? parts : []
  const runsById = new Map()
  const runsInOrder = []

  // First collect calls.
  for (const part of safeParts) {
    if (!isToolCallPart(part)) continue
    const id = getToolCallId(part) || `${runsInOrder.length}`
    const run = {
      id,
      name: getToolName(part),
      payload: getToolPayload(part),
      response: undefined,
    }
    runsById.set(id, run)
    runsInOrder.push(run)
  }

  // Then attach results.
  let resultIndex = 0
  for (const part of safeParts) {
    if (!isToolResultPart(part)) continue
    const id = getToolCallId(part)
    if (id && runsById.has(id)) {
      runsById.get(id).response = part?.content
      continue
    }
    // Fallback: attach in order.
    const run = runsInOrder[resultIndex]
    if (run && run.response == null) run.response = part?.content
    resultIndex++
  }

  return runsInOrder
}

function hasTextParts(message) {
  const parts = Array.isArray(message?.parts) ? message.parts : []
  return parts.some((p) => p?.type === 'text' && typeof p?.content === 'string' && p.content.trim())
}

function findPrevUserIndex(messages, index) {
  for (let i = index - 1; i >= 0; i--) {
    if (messages[i]?.role === 'user') return i
  }
  return -1
}

function collectToolRunsForAssistantTurn(messages, assistantIndex) {
  const start = findPrevUserIndex(messages, assistantIndex) + 1
  const end = assistantIndex
  const parts = []
  for (let i = start; i <= end; i++) {
    const m = messages[i]
    if (!m) continue
    const p = Array.isArray(m.parts) ? m.parts : []
    for (const part of p) {
      if (isToolCallPart(part) || isToolResultPart(part)) parts.push(part)
    }
  }
  return collectToolRunsFromParts(parts)
}

function getMessageText(message) {
  const parts = Array.isArray(message?.parts) ? message.parts : []
  return parts
    .map((p) => {
      if (p?.type === 'text' && typeof p.content === 'string') return p.content
      if (p?.type === 'thinking' && typeof p.content === 'string') return p.content
      return ''
    })
    .filter(Boolean)
    .join('')
}

function classifyIntent(userText) {
  const t = String(userText || '').trim()
  const lower = t.toLowerCase()
  if (!t) return 'OTHER'

  const isVerbatim = (() => {
    const signals = [
      'verbatim',
      'exact verses',
      'exact verse',
      'direct quote',
      'quote',
      'word for word',
      'last ',
    ]
    if (signals.some((s) => lower.includes(s))) return true
    if (/\blast\s+\d+\s+verses\b/i.test(t)) return true
    if (/\b(?:[1-3]\s*)?[a-z][a-z]+(?:\s+[a-z][a-z]+)*\s+\d{1,3}:\d{1,3}(?:-\d{1,3})?\b/i.test(t)) {
      if (/\bwhat\s+does\b.*\bsay\b/i.test(t)) return true
    }
    return false
  })()
  if (isVerbatim) return 'VERBATIM_QUOTE'

  const structuralSignals = [
    'books of the bible',
    'list ',
    'how many chapters',
    'chapter count',
    'how many books',
    'order of ',
    'which books',
    'how many',
    'count',
  ]
  if (structuralSignals.some((s) => lower.includes(s)) || /\bhow\s+many\b/i.test(lower)) {
    return 'STRUCTURAL'
  }

  const nonVerbatimSignals = ['explain', 'meaning', 'summarize', 'summary', 'overview', 'interpret', 'tell me about']
  if (nonVerbatimSignals.some((s) => lower.includes(s))) return 'NON_VERBATIM'

  return 'OTHER'
}

function uniqueToolNames(runs) {
  const names = []
  const seen = new Set()
  for (const r of Array.isArray(runs) ? runs : []) {
    const name = String(r?.name || '').trim()
    if (!name || seen.has(name)) continue
    seen.add(name)
    names.push(name)
  }
  return names
}

function parseRagSourcesFromRuns(runs) {
  const out = []
  for (const r of Array.isArray(runs) ? runs : []) {
    if (String(r?.name || '') !== 'rag_search_uploads') continue
    const raw = r?.response
    const s = typeof raw === 'string' ? raw.trim() : ''
    if (!s) continue
    try {
      const parsed = JSON.parse(s)
      const results = Array.isArray(parsed?.results) ? parsed.results : []
      for (const res of results.slice(0, 5)) {
        const filename = String(res?.filename || '').trim()
        const chunkId = String(res?.chunkId || res?.id || '').trim()
        const score = typeof res?.score === 'number' && Number.isFinite(res.score) ? res.score : null
        const pageStart = typeof res?.pageStart === 'number' && Number.isFinite(res.pageStart) ? Math.floor(res.pageStart) : null
        const pageEnd = typeof res?.pageEnd === 'number' && Number.isFinite(res.pageEnd) ? Math.floor(res.pageEnd) : null

        const pagePart = pageStart != null ? (pageEnd != null && pageEnd !== pageStart ? `p${pageStart}-${pageEnd}` : `p${pageStart}`) : ''
        const left = `${filename}${pagePart ? `:${pagePart}` : ''}`.trim()
        const inside = []
        if (chunkId) inside.push(chunkId)
        if (score != null) inside.push(score.toFixed(2))
        const label = `${left}${inside.length ? `(${inside.join(',')})` : ''}`.trim()
        if (label) out.push(label)
      }
    } catch {
      // ignore
    }
  }
  return out.slice(0, 5)
}

function getRagResultBundle(runs) {
  for (const r of Array.isArray(runs) ? runs : []) {
    if (String(r?.name || '') !== 'rag_search_uploads') continue
    const raw = r?.response
    const s = typeof raw === 'string' ? raw.trim() : ''
    if (!s) continue
    try {
      const parsed = JSON.parse(s)
      return parsed
    } catch {
      return null
    }
  }
  return null
}

function extractRagExcerpts(ragBundle) {
  const results = Array.isArray(ragBundle?.results) ? ragBundle.results : []
  return results
    .map((r) => String(r?.excerpt || r?.content || '').trim())
    .filter(Boolean)
}

function computeGrounding({ intent, assistantText, runs }) {
  if (intent !== 'VERBATIM_QUOTE') return 'N/A'

  const ragBundle = getRagResultBundle(runs)
  const excerpts = extractRagExcerpts(ragBundle)
  if (!excerpts.length) return 'FAIL'

  const corpus = excerpts.join('\n')
  const citationOk = /\[source:/i.test(String(assistantText || ''))

  // Conservative verifier: every non-empty line that isn't a citation line must appear verbatim in the retrieved excerpts.
  const lines = String(assistantText || '')
    .split(/\r?\n/g)
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('[') && l !== 'BADGES:' && l !== 'END_BADGES')

  if (!lines.length) return citationOk ? 'PASS' : 'FAIL'

  const allVerbatim = lines.every((l) => corpus.includes(l))
  return citationOk && allVerbatim ? 'PASS' : 'FAIL'
}

function computeRefusal({ intent, grounding, runs, assistantText }) {
  if (intent !== 'VERBATIM_QUOTE') return 'no'
  if (grounding === 'PASS') return 'no'

  const ragBundle = getRagResultBundle(runs)
  const toolError = Boolean(ragBundle && ragBundle.ok === false)
  const noMatch = Boolean(ragBundle && ragBundle.ok === true && Array.isArray(ragBundle.results) && ragBundle.results.length === 0)

  const text = String(assistantText || '')
  const looksLikeRefusal = /I cannot find this exact passage in the uploaded files\.|I cannot provide this information because it is not present verbatim in the uploaded documents\./i.test(
    text,
  )

  if (!looksLikeRefusal && (toolError || noMatch)) {
    // Still show refusal reason code because grounding failed for a verbatim request.
  }

  if (toolError) return 'yes:TOOL_ERROR'
  if (noMatch) return 'yes:NO_MATCH'
  return 'yes:NO_MATCH'
}

function computeDocMode({ userText, toolNames }) {
  const t = String(userText || '').toLowerCase()
  const explicitUpload = /\bupload\b|\buploaded\b|\battachment\b|\bfile\b|\bpdf\b|\bdocument\b/i.test(userText || '')
  const webRequested = /\bweb\b|\bgoogle\b|\bsearch\s+the\s+web\b|\bsearch\s+web\b/i.test(userText || '')

  if (toolNames.includes('rag_search_uploads') || explicitUpload) return 'UPLOAD_ONLY'
  if (webRequested) return 'WEB_REQUESTED'
  if (toolNames.includes('search_web') || toolNames.includes('fetch_url')) return 'WEB_ALLOWED'
  return 'NO_DOCS'
}

function computeToolPlan({ intent, userText, docMode }) {
  if (intent === 'STRUCTURAL') return 'NO_TOOLS'
  if (intent === 'VERBATIM_QUOTE') return 'RETRIEVE_REQUIRED'

  const explicitUpload = /\bupload\b|\buploaded\b|\battachment\b|\bfile\b|\bpdf\b|\bdocument\b/i.test(userText || '')
  if (docMode === 'WEB_REQUESTED') return 'WEB_SEARCH_REQUIRED'
  if (intent === 'NON_VERBATIM' && explicitUpload) return 'RETRIEVE_REQUIRED'
  return 'RETRIEVE_IF_UNCERTAIN'
}

function formatHudValue(value) {
  const v = String(value == null ? '' : value).trim()
  return v ? v : 'none'
}

export function ToolBadges({ messages, index }) {
  const message = Array.isArray(messages) ? messages[index] : null
  if (!message || message.role !== 'assistant') return null

  // Attach tool badges to the assistant message that contains the user-visible answer.
  if (!hasTextParts(message)) return null

  const runs = collectToolRunsForAssistantTurn(messages, index)
  const prevUserIndex = findPrevUserIndex(messages, index)
  const prevUser = prevUserIndex >= 0 ? messages[prevUserIndex] : null

  const userText = getMessageText(prevUser)
  const assistantText = getMessageText(message)

  const intent = classifyIntent(userText)
  const toolsCalled = uniqueToolNames(runs)
  const sources = parseRagSourcesFromRuns(runs)
  const docMode = computeDocMode({ userText, toolNames: toolsCalled })
  const toolPlan = computeToolPlan({ intent, userText, docMode })
  const grounding = computeGrounding({ intent, assistantText, runs })
  const refusal = computeRefusal({ intent, grounding, runs, assistantText })

  const hud = {
    intent,
    docMode,
    toolPlan,
    toolsCalled: toolsCalled.length ? toolsCalled.join(', ') : 'none',
    sources: sources.length ? sources.slice(0, 5).join(' ') : 'none',
    grounding,
    refusal,
  }

  const displayRuns = [
    {
      id: '__hud__',
      name: 'debug',
      payload: undefined,
      response: undefined,
      __hud: true,
    },
    ...runs,
  ]

  return (
    <div className="mt-2 flex flex-wrap items-start gap-2">
      {displayRuns.map((run) => {
        const hasResponse = run.response != null && String(run.response).length > 0
        const showHud = Boolean(run.__hud)
        return (
          <details key={run.id} className="group">
            <summary className="cursor-pointer list-none select-none">
              <span className="inline-flex items-center gap-2 border-4 border-black bg-sky-100 px-3 py-2 text-[11px] font-black uppercase tracking-widest text-black shadow-brutal-sm hover:bg-sky-200">
                <span>{run.name}</span>
                <span className="border-2 border-black bg-white px-2 py-1 text-[10px] font-black uppercase tracking-widest">
                  {showHud ? 'info' : hasResponse ? 'done' : 'running'}
                </span>
              </span>
            </summary>

            <div className="mt-2 w-[min(720px,calc(100vw-3rem))] border-4 border-black bg-white p-3 text-xs text-black shadow-brutal-sm">
              <div className="grid gap-3 md:grid-cols-2">
                <div>
                  <div className="mb-1 text-[11px] font-black uppercase tracking-widest">Payload</div>
                  <pre className="brutal-scroll max-h-56 overflow-auto border-4 border-black bg-yellow-100 p-3 font-mono text-[11px] leading-5">
                    {tryPrettyJson(run.payload) || '(empty)'}
                  </pre>
                </div>
                <div>
                  <div className="mb-1 text-[11px] font-black uppercase tracking-widest">Response</div>
                  <pre className="brutal-scroll max-h-56 overflow-auto border-4 border-black bg-lime-100 p-3 font-mono text-[11px] leading-5">
                    {tryPrettyJson(run.response) || '(pending)'}
                  </pre>
                </div>
              </div>

              {showHud ? (
                <div className="mt-3 border-t-4 border-black pt-3">
                  <div className="mb-2 text-[11px] font-black uppercase tracking-widest">Debug</div>
                  <div className="grid gap-2 md:grid-cols-2">
                    <div className="border-4 border-black bg-white p-3">
                      <div className="text-[11px] font-black uppercase tracking-widest">Intent</div>
                      <div className="mt-1 font-mono text-[11px] leading-5">{formatHudValue(hud.intent)}</div>
                    </div>
                    <div className="border-4 border-black bg-white p-3">
                      <div className="text-[11px] font-black uppercase tracking-widest">DocMode</div>
                      <div className="mt-1 font-mono text-[11px] leading-5">{formatHudValue(hud.docMode)}</div>
                    </div>
                    <div className="border-4 border-black bg-white p-3">
                      <div className="text-[11px] font-black uppercase tracking-widest">ToolPlan</div>
                      <div className="mt-1 font-mono text-[11px] leading-5">{formatHudValue(hud.toolPlan)}</div>
                    </div>
                    <div className="border-4 border-black bg-white p-3">
                      <div className="text-[11px] font-black uppercase tracking-widest">ToolsCalled</div>
                      <div className="mt-1 font-mono text-[11px] leading-5">{formatHudValue(hud.toolsCalled)}</div>
                    </div>
                    <div className="border-4 border-black bg-white p-3 md:col-span-2">
                      <div className="text-[11px] font-black uppercase tracking-widest">Sources</div>
                      <div className="mt-1 font-mono text-[11px] leading-5">{formatHudValue(hud.sources)}</div>
                    </div>
                    <div className="border-4 border-black bg-white p-3">
                      <div className="text-[11px] font-black uppercase tracking-widest">Grounding</div>
                      <div className="mt-1 font-mono text-[11px] leading-5">{formatHudValue(hud.grounding)}</div>
                    </div>
                    <div className="border-4 border-black bg-white p-3">
                      <div className="text-[11px] font-black uppercase tracking-widest">Refusal</div>
                      <div className="mt-1 font-mono text-[11px] leading-5">{formatHudValue(hud.refusal)}</div>
                    </div>
                  </div>
                </div>
              ) : null}
            </div>
          </details>
        )
      })}
    </div>
  )
}
