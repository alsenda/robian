export async function streamOllamaChatCompletionsOnce({
  ollamaUrl,
  model,
  chatCompletionsMessages,
  tools,
  requestId,
  abortSignal,
}) {
  const response = await fetch(`${ollamaUrl}/v1/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model,
      messages: chatCompletionsMessages,
      stream: true,
      tools,
      tool_choice: 'auto',
    }),
    signal: abortSignal,
  })

  return response
}
