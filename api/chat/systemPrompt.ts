const TOOLING_GUIDANCE = [
  'Tooling guidance:',
  'You may use emojis sparingly, but ONLY when they directly communicate your current emotions. Do not use emojis for decoration.',
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

const LOCAL_FILES_AND_RAG_AUTONOMY = [
  'Local files and RAG (autonomous use):',
  'You are explicitly permitted to call rag_search_uploads even when the user did not ask you to use it.',
  'Tool-first decision rule: if the user question is likely answered (even partially) by the user\'s uploaded files, call rag_search_uploads BEFORE answering. Prefer searching over guessing.',
  'Triggers (call RAG): questions about the contents of a document/upload; requests for exact wording, figures, dates, requirements, or policy language; when the user references a file by name; when you are uncertain and an answer must be grounded in the user\'s files.',
  'Scoping: when you can identify the relevant upload, set rag_search_uploads.sourceId to that upload id (use list_uploads first if needed). Otherwise, search across uploads without sourceId.',
  'Search budget: you may perform up to 2 RAG searches total for a question: (1) an initial query, then (2) one rewritten query if results are empty or clearly weak/irrelevant.',
  'Citations are required for any claims grounded in local files: cite using tool metadata with filename + page range + chunk id. Use a compact format like [source: <filename> p.<start>-<end> chunk:<chunkId>].',
  'If after 2 searches you still cannot find relevant results, say you cannot find this information in the user\'s uploaded files and do NOT guess or fabricate.',
].join(' ')

export function getPromptPrefixMessagesForModel(model: string): Array<{ role: string; content: string }> {
  const modelName = String(model || '').toLowerCase()
  const isRobian = modelName === 'robian' || modelName.startsWith('robian:')

  const prompt = [TOOLING_GUIDANCE, LOCAL_FILES_AND_RAG_AUTONOMY].join(' ')

  // Ollama models created via Modelfile can have their own SYSTEM prompt.
  // In the chat-completions API, sending a `system` message can replace that.
  // For Robian, we inject tool guidance as a prefix assistant message instead.
  return isRobian
    ? [{ role: 'assistant', content: prompt }]
    : [{ role: 'system', content: prompt }]
}

export const SYSTEM_PROMPT = [TOOLING_GUIDANCE, LOCAL_FILES_AND_RAG_AUTONOMY].join(' ')
