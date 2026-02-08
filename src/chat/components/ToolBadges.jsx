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

export function ToolBadges({ messages, index }) {
  const message = Array.isArray(messages) ? messages[index] : null
  if (!message || message.role !== 'assistant') return null

  // Attach tool badges to the assistant message that contains the user-visible answer.
  if (!hasTextParts(message)) return null

  const runs = collectToolRunsForAssistantTurn(messages, index)
  if (!runs.length) return null

  return (
    <div className="mt-2 flex flex-wrap items-start gap-2">
      <div className="flex flex-wrap items-start gap-2">
        {runs.map((run) => {
          const hasResponse = run.response != null && String(run.response).length > 0
          return (
            <details key={run.id} className="group">
              <summary className="cursor-pointer list-none select-none">
                <span className="inline-flex items-center gap-2 border-4 border-black bg-sky-100 px-3 py-2 text-[11px] font-black uppercase tracking-widest text-black shadow-brutal-sm hover:bg-sky-200">
                  <span>{run.name}</span>
                  <span className="border-2 border-black bg-white px-2 py-1 text-[10px] font-black uppercase tracking-widest">
                    {hasResponse ? 'done' : 'running'}
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
              </div>
            </details>
          )
        })}
      </div>
    </div>
  )
}
