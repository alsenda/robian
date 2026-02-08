import { toolDefinition } from '@tanstack/ai'
import { z } from 'zod'
import { searchWeb } from './searchWeb.js'

export const searchWebDef = toolDefinition({
  name: 'search_web',
  description:
    'Search the public web for relevant results. Use this for factual lookups that require external information not present in the conversation. Prefer sources that are likely fetchable as public HTML; avoid JS-heavy or bot-blocked sites (Twitter/X, Facebook, Medium, LinkedIn). After selecting promising results, use fetch_url to read pages before answering unless snippets are clearly sufficient.',
  inputSchema: z.object({
    query: z.string().min(2).describe('Search query text'),
    count: z
      .number()
      .int()
      .min(1)
      .max(10)
      .optional()
      .describe('Number of results to return (1-10)'),
  }),
  outputSchema: z.object({
    query: z.string(),
    results: z.array(
      z.object({
        title: z.string(),
        url: z.string(),
        snippet: z.string(),
      }),
    ),
    error: z
      .object({
        message: z.string(),
      })
      .optional(),
  }),
})

export const searchWebTool = searchWebDef.server(async ({ query, count }) => {
  const out = await searchWeb({ query, count })
  if (Array.isArray(out)) {
    return { query, results: out }
  }

  return {
    query,
    results: out?.results || [],
    error: out?.ok === false ? out?.error : undefined,
  }
})
