import { toolDefinition } from '@tanstack/ai'
import { z } from 'zod'
import { fetchTextFromUrl } from './fetchUrl.js'

export const fetchUrlDef = toolDefinition({
  name: 'fetch_url',
  description:
    'Fetch and extract readable text from a public http(s) URL. Use this to retrieve web page content when the user asks to look something up or provides a URL.',
  inputSchema: z.object({
    url: z.string().url().describe('The http(s) URL to fetch'),
    maxChars: z
      .number()
      .int()
      .min(500)
      .max(20_000)
      .optional()
      .describe('Maximum number of characters of extracted text to return'),
  }),
  outputSchema: z.object({
    ok: z.boolean().optional().describe('Whether the fetch succeeded'),
    url: z.string(),
    status: z.number(),
    content: z.string(),
    truncated: z.boolean().optional().describe('True when response text was truncated'),
    error: z
      .object({
        kind: z.string().optional(),
        message: z.string(),
      })
      .optional()
      .describe('Present when ok is false'),
  }),
})

export const fetchUrlTool = fetchUrlDef.server(async ({ url, maxChars }) => {
  const result = await fetchTextFromUrl({ url })
  const limit = typeof maxChars === 'number' ? maxChars : 8_000
  return {
    ok: Boolean(result.ok),
    url: result.url,
    status: result.status,
    content: (result.text || '').slice(0, limit),
    truncated: Boolean(result.truncated),
    error: result.ok ? undefined : result.error,
  }
})
