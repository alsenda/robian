export async function streamOllamaOpenAiOnce({
  ollamaUrl,
  model,
  openAiMessages,
  tools,
  requestId,
  abortSignal,
}) {
  const response = await fetch(`${ollamaUrl}/v1/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model,
      messages: openAiMessages,
      stream: true,
      tools,
      tool_choice: 'auto',
    }),
    signal: abortSignal,
  })

  return response
}
