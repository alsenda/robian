import { convertZodToJsonSchema } from '@tanstack/ai'

export { fetchUrlDef, fetchUrlTool } from './fetchUrl/fetchUrl.tool.js'
export { searchWebDef, searchWebTool } from './searchWeb/searchWeb.tool.js'
export { dateTodayDef, dateTodayTool } from './date/dateToday.tool.js'

export function toOpenAiTools(tools) {
  return tools.map((tool) => ({
    type: 'function',
    function: {
      name: tool.name,
      description: tool.description,
      parameters: convertZodToJsonSchema(tool.inputSchema),
    },
  }))
}
