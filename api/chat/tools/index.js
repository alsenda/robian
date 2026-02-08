import { convertZodToJsonSchema } from '@tanstack/ai'

export { fetchUrlDef, fetchUrlTool } from './fetchUrl/fetchUrl.tool.js'
export { searchWebDef, searchWebTool } from './searchWeb/searchWeb.tool.js'
export { dateTodayDef, dateTodayTool } from './date/dateToday.tool.js'

export {
  listUploadsDef,
  listUploadsTool,
} from '../../uploads/tools/listUploads.tool.js'
export { getUploadDef, getUploadTool } from '../../uploads/tools/getUpload.tool.js'
export {
  ragSearchUploadsDef,
  ragSearchUploadsTool,
} from '../../uploads/tools/ragSearchUploads.tool.js'

// Converts TanStack AI tool definitions into the Chat Completions `tools` wire format.
export function toChatCompletionsTools(tools) {
  return tools.map((tool) => ({
    type: 'function',
    function: {
      name: tool.name,
      description: tool.description,
      parameters: convertZodToJsonSchema(tool.inputSchema),
    },
  }))
}
