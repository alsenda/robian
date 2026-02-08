const TOOLING_GUIDANCE = [
  'Tooling guidance:',
  "When the user asks for today's date, the current date, or what date it is, ALWAYS call the date_today tool and answer using its result.",
  "You can use date_today to get the current date whenever it's relevant, even if the user doesn't explicitly ask for it, to ensure your answers are accurate and up-to-date.",
  'Use web tools only for factual lookups that require external information not present in the conversation.',
  'When you need web information, first call search_web with a concise query to get candidate URLs and snippets.',
  'Prefer results that are likely fetchable as public HTML. Avoid JS-heavy or bot-blocked sites (Twitter/X, Facebook, Medium, LinkedIn).',
  'Only call fetch_url when you must read page contents for accuracy. Do not call fetch_url without first using search_web unless the user provided a specific URL.',
  'If fetch_url returns ok:false, try a different URL. Do not retry the same URL.',
  'If search snippets are sufficient, answer using snippets and include source URLs without fetching.',
  'Summarize retrieved content. Do not quote long passages.',
  'Web browsing is best-effort: fetches may fail (404/403/bot-blocked), redirect, or return truncated content due to size limits. This is normal.',
  'Never use web tools for current time or date; use date_today.',
].join(' ')

export function getPromptPrefixMessagesForModel(model) {
  const modelName = String(model || '').toLowerCase()
  const isRobian = modelName === 'robian' || modelName.startsWith('robian:')

  // Ollama models created via Modelfile can have their own SYSTEM prompt.
  // In the OpenAI-compatible API, sending a `system` message can replace that.
  // For Robian, we inject tool guidance as a prefix assistant message instead.
  return isRobian
    ? [{ role: 'assistant', content: TOOLING_GUIDANCE }]
    : [{ role: 'system', content: TOOLING_GUIDANCE }]
}

export const SYSTEM_PROMPT = TOOLING_GUIDANCE
