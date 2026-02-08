import { getPromptPrefixMessagesForModel } from './systemPrompt.ts'
import { streamOllamaChatCompletionsOnce } from './ollama/client.ts'
import { createChatCompletionsStreamParser } from './ollama/streamParser.ts'

export type ServerTool = {
  name: string
  execute: (input: unknown) => Promise<unknown>
}

export async function* streamChatWithTools({
  ollamaUrl,
  model,
  requestId,
  chatCompletionsMessages,
  firstResponse,
  tools,
  serverTools,
  abortSignal,
}: {
  ollamaUrl: string
  model: string
  requestId: string
  chatCompletionsMessages: unknown[]
  firstResponse: Response | null | undefined
  tools: unknown
  serverTools: ServerTool[]
  abortSignal?: AbortSignal
}): AsyncGenerator<unknown, void, void> {
  const prefixMessages = getPromptPrefixMessagesForModel(model)
  const conversation = [...prefixMessages, ...chatCompletionsMessages]

  for (let iteration = 0; iteration < 3; iteration++) {
    if (abortSignal?.aborted) return

    let response = firstResponse
    if (iteration > 0 || !response) {
      try {
        response = await streamOllamaChatCompletionsOnce({
          ollamaUrl,
          model,
          chatCompletionsMessages: conversation,
          tools,
          requestId,
          ...(abortSignal ? { abortSignal } : {}),
        })
      } catch (error: unknown) {
        if (abortSignal?.aborted) return
        const message = error instanceof Error ? error.message : 'unknown error'
        if (process.env.NODE_ENV !== 'test') {
          console.error(`[chat] ollama unreachable: ${message}`)
        }
        yield {
          type: 'error',
          id: requestId,
          model,
          timestamp: Date.now(),
          error: { message: message || 'Could not reach Ollama' },
        }
        return
      }

      if (!response.ok) {
        if (process.env.NODE_ENV !== 'test') {
          console.error(`[chat] ollama error: ${response.status} ${response.statusText}`)
        }
        yield {
          type: 'error',
          id: requestId,
          model,
          timestamp: Date.now(),
          error: { message: `Ollama error: ${response.status} ${response.statusText}` },
        }
        return
      }
    }

    firstResponse = null

    const { state, parse } = createChatCompletionsStreamParser({
      requestId,
      model,
      ...(abortSignal ? { abortSignal } : {}),
    })

    try {
      for await (const chunk of parse({ response })) {
        yield chunk
      }
    } catch (error: unknown) {
      if (abortSignal?.aborted) return
      const message = error instanceof Error ? error.message : 'unknown error'
      if (process.env.NODE_ENV !== 'test') {
        console.error(`[chat] stream parse error: ${message}`)
      }
      yield {
        type: 'error',
        id: requestId,
        model,
        timestamp: Date.now(),
        error: { message: message || 'Stream parse error' },
      }
      return
    }

    const toolCalls = [...state.toolCallsByIndex.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([, value]) => value)
      .filter((c: any) => c && c.name)

    if (!toolCalls.length) {
      yield {
        type: 'done',
        id: requestId,
        model: state.resolvedModel,
        timestamp: Date.now(),
        finishReason: state.finishReason || 'stop',
      }
      return
    }

    conversation.push({
      role: 'assistant',
      content: state.fullContent || null,
      tool_calls: toolCalls.map((c: any) => ({
        id: c.id,
        type: 'function',
        function: {
          name: c.name,
          arguments: c.arguments,
        },
      })),
    })

    for (const toolCall of toolCalls as any[]) {
      if (process.env.NODE_ENV !== 'test') {
        console.log(`[chat] tool: ${toolCall.name}`)
      }

      const tool = serverTools.find((t) => t.name === toolCall.name)
      if (!tool) {
        const errorText = `Unknown tool: ${toolCall.name}`
        yield {
          type: 'tool_result',
          id: requestId,
          model,
          timestamp: Date.now(),
          toolCallId: toolCall.id,
          content: errorText,
        }
        conversation.push({ role: 'tool', tool_call_id: toolCall.id, content: errorText })
        continue
      }

      let parsedArgs: unknown
      try {
        parsedArgs = toolCall.arguments ? JSON.parse(toolCall.arguments) : {}
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : 'parse error'
        const errorText = `Invalid tool arguments: ${message}`
        yield {
          type: 'tool_result',
          id: requestId,
          model,
          timestamp: Date.now(),
          toolCallId: toolCall.id,
          content: errorText,
        }
        conversation.push({ role: 'tool', tool_call_id: toolCall.id, content: errorText })
        continue
      }

      try {
        const output = await tool.execute(parsedArgs)
        const content = typeof output === 'string' ? output : JSON.stringify(output)
        yield {
          type: 'tool_result',
          id: requestId,
          model,
          timestamp: Date.now(),
          toolCallId: toolCall.id,
          content,
        }
        conversation.push({ role: 'tool', tool_call_id: toolCall.id, content })
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : 'Tool execution failed'
        yield {
          type: 'tool_result',
          id: requestId,
          model,
          timestamp: Date.now(),
          toolCallId: toolCall.id,
          content: message,
        }
        conversation.push({ role: 'tool', tool_call_id: toolCall.id, content: message })
      }
    }
  }

  yield {
    type: 'done',
    id: requestId,
    model,
    timestamp: Date.now(),
    finishReason: 'stop',
  }
}
