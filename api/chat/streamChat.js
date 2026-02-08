import { SYSTEM_PROMPT } from './systemPrompt.js'
import { streamOllamaOpenAiOnce } from './ollama/client.js'
import { createOpenAiStreamParser } from './ollama/streamParser.js'
import { dateTodayTool, fetchUrlTool, searchWebTool } from './tools/index.js'

export async function* streamChatWithTools({
  ollamaUrl,
  model,
  requestId,
  openAiMessages,
  firstResponse,
  tools,
  abortSignal,
}) {
  const serverTools = [fetchUrlTool, searchWebTool, dateTodayTool]

  const system = {
    role: 'system',
    content: SYSTEM_PROMPT,
  }

  const conversation = [system, ...openAiMessages]

  for (let iteration = 0; iteration < 3; iteration++) {
    if (abortSignal?.aborted) return

    let response = firstResponse
    if (iteration > 0 || !response) {
      try {
        response = await streamOllamaOpenAiOnce({
          ollamaUrl,
          model,
          openAiMessages: conversation,
          tools,
          requestId,
          abortSignal,
        })
      } catch (error) {
        if (abortSignal?.aborted) return
        if (process.env.NODE_ENV !== 'test') {
          console.error(`[chat] ollama unreachable: ${error?.message || 'unknown error'}`)
        }
        yield {
          type: 'error',
          id: requestId,
          model,
          timestamp: Date.now(),
          error: { message: error?.message || 'Could not reach Ollama' },
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
          error: {
            message: `Ollama error: ${response.status} ${response.statusText}`,
          },
        }
        return
      }
    }

    firstResponse = null

    const { state, parse } = createOpenAiStreamParser({
      requestId,
      model,
      abortSignal,
    })

    try {
      for await (const chunk of parse({ response })) {
        yield chunk
      }
    } catch (error) {
      if (abortSignal?.aborted) return
      if (process.env.NODE_ENV !== 'test') {
        console.error(`[chat] stream parse error: ${error?.message || 'unknown error'}`)
      }
      yield {
        type: 'error',
        id: requestId,
        model,
        timestamp: Date.now(),
        error: { message: error?.message || 'Stream parse error' },
      }
      return
    }

    const toolCalls = [...state.toolCallsByIndex.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([, value]) => value)
      .filter((c) => c && c.name)

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
      tool_calls: toolCalls.map((c) => ({
        id: c.id,
        type: 'function',
        function: {
          name: c.name,
          arguments: c.arguments,
        },
      })),
    })

    for (const toolCall of toolCalls) {
      if (process.env.NODE_ENV !== 'test') {
        console.log(`[chat] tool: ${toolCall.name}`)
      }

      const tool = serverTools.find((t) => t.name === toolCall.name)
      if (!tool) {
        const errorText = `Unknown tool: ${toolCall.name}`
        yield {
          type: 'tool-result',
          toolCallId: toolCall.id,
          content: errorText,
        }
        conversation.push({
          role: 'tool',
          tool_call_id: toolCall.id,
          content: errorText,
        })
        continue
      }

      let parsedArgs
      try {
        parsedArgs = toolCall.arguments ? JSON.parse(toolCall.arguments) : {}
      } catch (error) {
        const errorText = `Invalid tool arguments: ${error?.message || 'parse error'}`
        yield {
          type: 'tool-result',
          toolCallId: toolCall.id,
          content: errorText,
        }
        conversation.push({
          role: 'tool',
          tool_call_id: toolCall.id,
          content: errorText,
        })
        continue
      }

      try {
        const output = await tool.execute(parsedArgs)
        const content = typeof output === 'string' ? output : JSON.stringify(output)
        yield {
          type: 'tool-result',
          toolCallId: toolCall.id,
          content,
        }
        conversation.push({
          role: 'tool',
          tool_call_id: toolCall.id,
          content,
        })
      } catch (error) {
        const errorText = error?.message || 'Tool execution failed'
        yield {
          type: 'tool-result',
          toolCallId: toolCall.id,
          content: errorText,
        }
        conversation.push({
          role: 'tool',
          tool_call_id: toolCall.id,
          content: errorText,
        })
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
