import { randomUUID } from 'node:crypto'

export function createChatCompletionsStreamParser({ requestId, model, abortSignal }) {
  const state = {
    fullContent: '',
    finishReason: 'stop',
    toolCallsByIndex: new Map(),
    resolvedModel: model,
  }

  const parse = async function* ({ response }) {
    const decoder = new TextDecoder()
    const reader = response.body?.getReader()
    if (!reader) {
      throw new Error('Ollama response body is not readable')
    }

    let buffer = ''
    try {
      while (true) {
        if (abortSignal?.aborted) return
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })

        const lines = buffer.split('\n')
        buffer = lines.pop() || ''

        for (const line of lines) {
          const trimmed = line.trim()
          if (!trimmed.startsWith('data:')) continue
          const payload = trimmed.slice('data:'.length).trim()
          if (!payload) continue
          if (payload === '[DONE]') return

          let parsed
          try {
            parsed = JSON.parse(payload)
          } catch {
            continue
          }

          if (typeof parsed?.model === 'string') {
            state.resolvedModel = parsed.model
          }

          const choice = parsed?.choices?.[0]
          const delta = choice?.delta

          if (typeof choice?.finish_reason === 'string') {
            state.finishReason = choice.finish_reason
          }

          const contentDelta = delta?.content
          if (typeof contentDelta === 'string' && contentDelta.length > 0) {
            state.fullContent += contentDelta
            yield {
              type: 'content',
              id: requestId,
              model: state.resolvedModel,
              timestamp: Date.now(),
              delta: contentDelta,
              content: state.fullContent,
              role: 'assistant',
            }
          }

          const toolDeltas = delta?.tool_calls
          if (Array.isArray(toolDeltas)) {
            for (let i = 0; i < toolDeltas.length; i++) {
              const toolDelta = toolDeltas[i]
              const index = typeof toolDelta?.index === 'number' ? toolDelta.index : i

              const existing = state.toolCallsByIndex.get(index) || {
                id: toolDelta?.id || randomUUID(),
                name: toolDelta?.function?.name || '',
                arguments: '',
              }

              if (typeof toolDelta?.id === 'string' && toolDelta.id) {
                existing.id = toolDelta.id
              }
              // Support streamed tool_calls deltas as well as provider variants that use
              // { name, parameters } or legacy function_call shapes.
              const functionPayload =
                toolDelta?.function && typeof toolDelta.function === 'object'
                  ? toolDelta.function
                  : toolDelta

              if (typeof functionPayload?.name === 'string' && functionPayload.name) {
                existing.name = functionPayload.name
              }

              let argsDelta =
                typeof functionPayload?.arguments === 'string' ? functionPayload.arguments : ''

              if (!argsDelta && typeof functionPayload?.parameters === 'string') {
                argsDelta = functionPayload.parameters
              }

              if (
                !argsDelta &&
                functionPayload?.parameters &&
                typeof functionPayload.parameters === 'object'
              ) {
                // Some providers send parameters as an object (not a streamed JSON string).
                if (!existing.arguments) {
                  existing.arguments = JSON.stringify(functionPayload.parameters)
                }
              } else if (argsDelta) {
                existing.arguments += argsDelta
              }

              state.toolCallsByIndex.set(index, existing)

              if (existing.name) {
                yield {
                  type: 'tool-call',
                  index,
                  toolCall: {
                    id: existing.id,
                    function: {
                      name: existing.name,
                      arguments: argsDelta,
                    },
                  },
                }
              }
            }
          }

          // Legacy single function_call (some providers/models).
          const legacyFn = delta?.function_call
          if (legacyFn && typeof legacyFn === 'object') {
            const index = 0
            const existing = state.toolCallsByIndex.get(index) || {
              id: randomUUID(),
              name: '',
              arguments: '',
            }

            if (typeof legacyFn?.name === 'string' && legacyFn.name) {
              existing.name = legacyFn.name
            }

            let argsDelta = typeof legacyFn?.arguments === 'string' ? legacyFn.arguments : ''
            if (!argsDelta && typeof legacyFn?.parameters === 'string') {
              argsDelta = legacyFn.parameters
            }
            if (!argsDelta && legacyFn?.parameters && typeof legacyFn.parameters === 'object') {
              if (!existing.arguments) {
                existing.arguments = JSON.stringify(legacyFn.parameters)
              }
            } else if (argsDelta) {
              existing.arguments += argsDelta
            }

            state.toolCallsByIndex.set(index, existing)

            if (existing.name) {
              yield {
                type: 'tool-call',
                index,
                toolCall: {
                  id: existing.id,
                  function: {
                    name: existing.name,
                    arguments: argsDelta,
                  },
                },
              }
            }
          }
        }
      }
    } finally {
      reader.releaseLock()
    }
  }

  return { state, parse }
}
