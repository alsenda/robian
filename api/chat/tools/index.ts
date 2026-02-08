import { convertZodToJsonSchema } from '@tanstack/ai'
import type { ZodTypeAny } from 'zod'

export { fetchUrlDef, fetchUrlTool } from './fetchUrl/fetchUrl.tool.js'
export { searchWebDef, searchWebTool } from './searchWeb/searchWeb.tool.js'
export { dateTodayDef, dateTodayTool } from './date/dateToday.tool.js'

import { fetchUrlTool } from './fetchUrl/fetchUrl.tool.js'
import { searchWebTool } from './searchWeb/searchWeb.tool.js'
import { dateTodayTool } from './date/dateToday.tool.js'

export { listUploadsDef, listUploadsTool } from '../../uploads/tools/listUploads.tool.js'
export { getUploadDef, getUploadTool } from '../../uploads/tools/getUpload.tool.js'

import { listUploadsTool } from '../../uploads/tools/listUploads.tool.js'
import { getUploadTool } from '../../uploads/tools/getUpload.tool.js'

import { ragSearchUploadsDef, createRagSearchUploadsTool } from '../../uploads/tools/ragSearchUploads.tool.ts'
import type { RagService } from '../../rag/types.js'

export { ragSearchUploadsDef }

export type ServerTool = {
  name: string
  execute: (input: unknown) => Promise<unknown>
}

export function createServerTools({ ragService }: { ragService: RagService }): ServerTool[] {
  return [
    fetchUrlTool as unknown as ServerTool,
    searchWebTool as unknown as ServerTool,
    dateTodayTool as unknown as ServerTool,
    listUploadsTool as unknown as ServerTool,
    getUploadTool as unknown as ServerTool,
    createRagSearchUploadsTool(ragService) as unknown as ServerTool,
  ]
}

// Converts TanStack AI tool definitions into the Chat Completions `tools` wire format.
export function toChatCompletionsTools(
  tools: Array<{ name: string; description: string; inputSchema?: ZodTypeAny }>,
) {
  return tools.map((tool) => ({
    type: 'function',
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.inputSchema ? convertZodToJsonSchema(tool.inputSchema) : {},
    },
  }))
}
