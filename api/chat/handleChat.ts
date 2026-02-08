import {
  convertMessagesToModelMessages,
  toServerSentEventsStream,
} from "@tanstack/ai";
import { randomUUID } from "node:crypto";
import { Readable } from "node:stream";
import type { Request, Response as ExpressResponse } from "express";

import { getPromptPrefixMessagesForModel } from "./systemPrompt.ts";
import { toChatCompletionsMessages } from "./utils/messages.ts";
import {
  dateTodayDef,
  fetchUrlDef,
  getUploadDef,
  listUploadsDef,
  ragSearchUploadsDef,
  searchWebDef,
  toChatCompletionsTools,
  createServerTools,
} from "./tools/index.ts";
import { streamOllamaChatCompletionsOnce } from "./ollama/client.ts";
import { streamChatWithTools } from "./streamChat.ts";
import type { RagService } from "../rag/types.ts";

const DEFAULT_OLLAMA_URL = "http://localhost:11434";
const DEFAULT_OLLAMA_MODEL = "robian:latest";

function stripTrailingSlashes(text: string): string {
  return String(text || "").replace(/\/+$/, "");
}

function isEnvTrue(value: unknown): boolean {
  const v = String(value ?? "").trim().toLowerCase();
  return v === "1" || v === "true" || v === "yes" || v === "on";
}

function looksDocRelated(text: string): boolean {
  const t = String(text || "").toLowerCase();
  if (!t.trim()) { return false; }
  const signals = [
    "pdf",
    "document",
    "doc",
    "contract",
    "invoice",
    "policy",
    "statement",
    "uploaded",
    "upload",
    "file",
    "what does it say",
    "what does the file say",
    "according to",
    "in the attachment",
  ];
  return signals.some((s) => t.includes(s));
}

function hasCitationMarkers(text: string): boolean {
  return /\[source:/i.test(String(text || ""));
}

function extractLikelyUploadId(text: string): string | undefined {
  const t = String(text || "");

  // UUID-ish ids are commonly used by uploads.
  const uuid = t.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
  if (uuid?.[0]) { return uuid[0]; }

  // Also accept explicit "upload <id>" or "sourceId <id>" patterns.
  const explicit = t.match(/\b(?:upload|sourceid)\s*[:#]?\s*([a-zA-Z0-9_-]{2,})\b/i);
  if (explicit?.[1]) { return explicit[1]; }

  return undefined;
}

async function collectChunks(stream: AsyncGenerator<unknown, void, void>): Promise<{ chunks: unknown[]; content: string }> {
  const chunks: unknown[] = [];
  let content = "";
  for await (const chunk of stream) {
    chunks.push(chunk);
    const c = chunk as any;
    if (c && c.type === "content" && typeof c.content === "string") {
      content = c.content;
    }
  }
  return { chunks, content };
}

async function* replayChunks(chunks: unknown[]): AsyncGenerator<unknown, void, void> {
  for (const chunk of chunks) { yield chunk; }
}

export function createHandleChat({
  ragService,
}: {
  ragService: RagService,
}): (req: Request, res: ExpressResponse) => Promise<void> {
  const serverTools = createServerTools({ rag: ragService });

  return async function handleChat(req: Request, res: ExpressResponse): Promise<void> {
    const { messages } = (req.body as { messages?: unknown } | undefined) ?? {};

    if (!messages || !Array.isArray(messages)) {
      res.status(400).json({ error: 'Missing "messages" array in request body' });
      return;
    }

    try {
      const abortController = new AbortController();
      res.on("close", () => abortController.abort());
      req.on("aborted", () => abortController.abort());

      if (process.env.NODE_ENV !== "test") {
        console.log(`[chat] request: messages=${messages.length}`);
      }

      const ollamaUrl = stripTrailingSlashes(process.env.OLLAMA_URL || DEFAULT_OLLAMA_URL);
      const model = process.env.OLLAMA_MODEL || DEFAULT_OLLAMA_MODEL;
      const requestId = randomUUID();

      const modelMessages = convertMessagesToModelMessages(messages as any);
      const chatCompletionsMessages = toChatCompletionsMessages(modelMessages);

      const tools = toChatCompletionsTools([
        searchWebDef,
        fetchUrlDef,
        dateTodayDef,
        listUploadsDef,
        getUploadDef,
        ragSearchUploadsDef,
      ]);

      const prefixMessages = getPromptPrefixMessagesForModel(model);
      const firstConversation = [...prefixMessages, ...chatCompletionsMessages];

      let firstResponse: Response | null | undefined;
      try {
        firstResponse = (await streamOllamaChatCompletionsOnce({
          ollamaUrl,
          model,
          chatCompletionsMessages: firstConversation,
          tools,
          requestId,
          abortSignal: abortController.signal,
        })) as unknown as Response;
      } catch (error: unknown) {
        if (abortController.signal.aborted) { return; }
        const message = error instanceof Error ? error.message : "unknown error";
        if (process.env.NODE_ENV !== "test") {
          console.error(`[chat] ollama unreachable: ${message}`);
        }
        res.status(502).json({
          error: `Could not reach Ollama at ${ollamaUrl} (is it running?)`,
        });
        return;
      }

      if (!firstResponse || !firstResponse.ok) {
        const status = firstResponse?.status || 502;
        if (process.env.NODE_ENV !== "test") {
          console.error(`[chat] ollama error: ${firstResponse?.status} ${firstResponse?.statusText}`);
        }
        res.status(status).json({
          error: `Ollama error: ${firstResponse?.status} ${firstResponse?.statusText}`,
        });
        return;
      }

      res.status(200);
      res.setHeader("Content-Type", "text/event-stream");
      res.setHeader("Cache-Control", "no-cache, no-transform");
      res.setHeader("Connection", "keep-alive")
      ; (res as unknown as { flushHeaders?: () => void }).flushHeaders?.();

      res.write(": connected\n\n");

      const autoNudgeEnabled = isEnvTrue(process.env.RAG_AUTONUDGE);

      const lastUserText = (() => {
        for (let i = chatCompletionsMessages.length - 1; i >= 0; i--) {
          const m = chatCompletionsMessages[i] as any;
          if (m && m.role === "user" && typeof m.content === "string") { return m.content; }
        }
        return "";
      })();

      let stream: AsyncGenerator<unknown, void, void>;

      if (!autoNudgeEnabled || !looksDocRelated(lastUserText)) {
        stream = streamChatWithTools({
          ollamaUrl,
          model,
          requestId,
          chatCompletionsMessages,
          firstResponse,
          tools,
          serverTools,
          abortSignal: abortController.signal,
        });
      } else {
        const firstPass = streamChatWithTools({
          ollamaUrl,
          model,
          requestId,
          chatCompletionsMessages,
          firstResponse,
          tools,
          serverTools,
          abortSignal: abortController.signal,
        });

        const collected1 = await collectChunks(firstPass);
        if (hasCitationMarkers(collected1.content) || abortController.signal.aborted) {
          stream = replayChunks(collected1.chunks);
        } else {
          // One-shot nudge: force a single RAG search and re-ask once.
          const ragTool = serverTools.find((t) => t.name === "rag_search_uploads");
          const listTool = serverTools.find((t) => t.name === "list_uploads");

          let sourceId: string | undefined = extractLikelyUploadId(lastUserText);
          if (!sourceId && listTool) {
            try {
              const out = (await listTool.execute({ limit: 50 })) as any;
              const uploads = Array.isArray(out?.uploads) ? out.uploads : [];
              if (uploads.length === 1 && typeof uploads[0]?.id === "string" && uploads[0].id) {
                sourceId = uploads[0].id;
              }
            } catch {
              // ignore
            }
          }

          let toolContent = "";
          if (ragTool) {
            try {
              const ragArgs: any = { query: lastUserText, topK: 6 };
              if (sourceId) { ragArgs.sourceId = sourceId; }
              const output = await ragTool.execute(ragArgs);
              toolContent = typeof output === "string" ? output : JSON.stringify(output);
            } catch (error: unknown) {
              toolContent = error instanceof Error ? error.message : "rag_search_uploads failed";
            }
          } else {
            toolContent = "rag_search_uploads tool unavailable";
          }

          const toolCallId = randomUUID();
          const nudgedMessages: any[] = [
            ...chatCompletionsMessages,
            {
              role: "assistant",
              content: null,
              tool_calls: [
                {
                  id: toolCallId,
                  type: "function",
                  function: {
                    name: "rag_search_uploads",
                    arguments: JSON.stringify({ query: lastUserText, topK: 6, ...(sourceId ? { sourceId } : {}) }),
                  },
                },
              ],
            },
            { role: "tool", tool_call_id: toolCallId, content: toolContent },
          ];

          const prefixMessages2 = getPromptPrefixMessagesForModel(model);
          const firstConversation2 = [...prefixMessages2, ...nudgedMessages];

          const firstResponse2 = (await streamOllamaChatCompletionsOnce({
            ollamaUrl,
            model,
            chatCompletionsMessages: firstConversation2,
            tools,
            requestId,
            abortSignal: abortController.signal,
          })) as unknown as Response;

          const secondPass = streamChatWithTools({
            ollamaUrl,
            model,
            requestId,
            chatCompletionsMessages: nudgedMessages,
            firstResponse: firstResponse2,
            tools,
            serverTools,
            abortSignal: abortController.signal,
          });

          const collected2 = await collectChunks(secondPass);
          stream = replayChunks(collected2.chunks);
        }
      }

      const sseStream = toServerSentEventsStream(stream as unknown as any, abortController);
      const nodeStream = Readable.fromWeb(sseStream as unknown as any);

      nodeStream.on("error", (error: unknown) => {
        if (abortController.signal.aborted) { return; }
        console.error("SSE stream error:", error);
        try {
          res.end();
        } catch {
          // ignore
        }
      });

      res.on("error", (error: unknown) => {
        if (abortController.signal.aborted) { return; }
        console.error("Response error:", error);
        abortController.abort()
        ; (nodeStream as unknown as { destroy: (e: unknown) => void }).destroy(error);
      })

      ; (nodeStream as unknown as { pipe: (r: unknown) => void }).pipe(res);
    } catch (error: unknown) {
      console.error("Chat error:", error);
      const message = error instanceof Error ? error.message : "Chat error";
      res.status(500).json({ error: message });
    }
  };
}
