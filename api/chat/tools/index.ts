import { convertZodToJsonSchema } from '@tanstack/ai'
import type { ZodTypeAny } from 'zod'

export { fetchUrlDef, fetchUrlTool } from './fetchUrl/fetchUrl.tool.ts'
export { searchWebDef, searchWebTool } from './searchWeb/searchWeb.tool.ts'
export { dateTodayDef, dateTodayTool } from './date/dateToday.tool.ts'

import { fetchUrlTool } from './fetchUrl/fetchUrl.tool.ts'
import { searchWebTool } from './searchWeb/searchWeb.tool.ts'
import { dateTodayTool } from './date/dateToday.tool.ts'

export { listUploadsDef, listUploadsTool } from '../../uploads/tools/listUploads.tool.ts'
export { getUploadDef, getUploadTool } from '../../uploads/tools/getUpload.tool.ts'

import { listUploadsTool } from '../../uploads/tools/listUploads.tool.ts'
import { getUploadTool } from '../../uploads/tools/getUpload.tool.ts'

import { ragSearchUploadsDef, createRagSearchUploadsTool } from '../../uploads/tools/ragSearchUploads.tool.ts'
import type { RagService } from '../../rag/types.ts'

export { ragSearchUploadsDef }

export type ServerTool = {
  name: string
  execute: (input: unknown) => Promise<unknown>
}

export function createServerTools({ rag }: { rag: RagService }): ServerTool[] {
  return [
    fetchUrlTool as unknown as ServerTool,
    searchWebTool as unknown as ServerTool,
    dateTodayTool as unknown as ServerTool,
    listUploadsTool as unknown as ServerTool,
    getUploadTool as unknown as ServerTool,
    createRagSearchUploadsTool({ rag }) as unknown as ServerTool,
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
