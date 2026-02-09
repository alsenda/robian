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
import {
  validateCitationsAgainstAllowlist,
  type AllowedChunkRef,
} from "./utils/citations.ts";
import { buildRagPrompt } from "../../src/server/rag/prompt/buildPrompt.ts";
import { chat as ollamaGenerate } from "../../src/server/rag/llm/ollamaChat.ts";

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

  // Retrieval is required when the user is explicitly asking about uploaded files/docs.
  const docSignals = [
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
    "attachment",
    "what does it say",
    "what does the file say",
    "according to",
    "in the attachment",
  ];
  if (docSignals.some((s) => t.includes(s))) { return true; }

  // Retrieval is also required for verbatim / exact quote requests (including verse text requests).
  const quoteSignals = [
    "verbatim",
    "exact wording",
    "exact words",
    "exact verse",
    "exact verses",
    "direct quote",
    "quote",
    "quoted",
    "word for word",
    "what does it say",
    "what does",
    "says",
    "say?",
    "text of",
  ];

  // Bible reference pattern like "John 3:16" or "1 Corinthians 13:4-7".
  const bibleRef = /\b(?:[1-3]\s*)?[a-z][a-z]+(?:\s+[a-z][a-z]+)*\s+\d{1,3}:\d{1,3}(?:-\d{1,3})?\b/i;
  const hasRef = bibleRef.test(text);
  if (hasRef && quoteSignals.some((s) => t.includes(s))) { return true; }

  return false;
}

function hasCitationMarkers(text: string): boolean {
  return /\[source:/i.test(String(text || ""));
}

function isVerbatimRequest(text: string): boolean {
  const t = String(text || "").toLowerCase();
  if (!t.trim()) { return false; }
  const signals = [
    "verbatim",
    "exact verse",
    "exact verses",
    "exact wording",
    "exact words",
    "direct quote",
    "quote",
    "quoted",
    "word for word",
    "text of",
  ];
  if (signals.some((s) => t.includes(s))) { return true; }

  // If the user asks what a specific verse "says", treat as verbatim.
  const bibleRef = /\b(?:[1-3]\s*)?[a-z][a-z]+(?:\s+[a-z][a-z]+)*\s+\d{1,3}:\d{1,3}(?:-\d{1,3})?\b/i;
  const asksSays = /\bwhat\s+does\b.*\bsay\b|\bwhat\s+does\b.*\bsays\b|\bwhat\s+does\s+.*\bsay\?\b/i.test(String(text || ""));
  if (bibleRef.test(String(text || "")) && asksSays) { return true; }

  return false;
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

function parseEnvNumber(value: unknown, fallback: number): number {
  const raw = typeof value === "string" ? value.trim() : value;
  const n = typeof raw === "number" ? raw : raw != null ? Number(raw) : NaN;
  if (!Number.isFinite(n)) { return fallback; }
  return n;
}

function isUuidLike(value: string | undefined): boolean {
  if (!value) { return false; }
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}

function deterministicRewriteQuery(text: string): string {
  const input = String(text ?? "").trim();
  if (!input) { return ""; }

  const quoted: string[] = [];
  for (const m of input.matchAll(/"([^"]{2,})"|'([^']{2,})'/g)) {
    const q = String(m[1] || m[2] || "").trim();
    if (q) { quoted.push(q); }
  }

  const fileMatch = input.match(/\b[\w.-]+\.(?:pdf|txt|md|docx|pptx|html)\b/gi);
  const filenames = fileMatch ? Array.from(new Set(fileMatch.map((f) => f.trim()))).slice(0, 2) : [];

  const cleaned = input
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, " ")
    .replace(/[^\p{L}\p{N}.\-\s]+/gu, " ")
    .replace(/\s{2,}/g, " ")
    .trim();

  const stop = new Set([
    "please",
    "can",
    "could",
    "would",
    "tell",
    "me",
    "about",
    "what",
    "whats",
    "is",
    "are",
    "the",
    "a",
    "an",
    "in",
    "on",
    "from",
    "for",
    "of",
    "and",
    "to",
    "according",
    "upload",
    "uploaded",
    "file",
    "document",
    "pdf",
  ]);

  const terms: string[] = [];
  for (const part of cleaned.split(/\s+/g)) {
    const t = part.trim();
    if (t.length < 3) { continue; }
    const lower = t.toLowerCase();
    if (stop.has(lower)) { continue; }
    if (terms.includes(t)) { continue; }
    terms.push(t);
    if (terms.length >= 10) { break; }
  }

  const pieces = [...quoted.map((q) => `"${q}"`), ...filenames, ...terms].filter(Boolean);
  const rewritten = pieces.join(" ").trim();
  return rewritten || input;
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

      const lastUserText = (() => {
        for (let i = chatCompletionsMessages.length - 1; i >= 0; i--) {
          const m = chatCompletionsMessages[i] as any;
          if (m && m.role === "user" && typeof m.content === "string") { return m.content; }
        }
        return "";
      })();

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

      const docRelated = looksDocRelated(lastUserText);
      const ragMinScore = parseEnvNumber(process.env.RAG_MIN_SCORE, 0.45);
      const ragTopK = Math.max(1, Math.min(50, Math.floor(parseEnvNumber(process.env.RAG_DOC_TOPK, 8))));

      // Doc-related path: enforce retrieve-before-answer and validate citations server-side.
      if (docRelated) {
        const listTool = serverTools.find((t) => t.name === "list_uploads");

        let sourceId: string | undefined = extractLikelyUploadId(lastUserText);
        if (!isUuidLike(sourceId)) { sourceId = undefined; }

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

        const retrievalAttempts: Array<{ args: any; result: any }> = [];

        const runRetrieval = async (query: string) => {
          const args: any = { query, topK: ragTopK, ...(sourceId ? { sourceId } : {}) };
          const result = await ragService.query(query, ragTopK, {
            source: "upload",
            ...(sourceId ? { sourceId } : {}),
          });
          retrievalAttempts.push({ args, result });
          return result;
        };

        const q1 = String(lastUserText || "").trim();
        const out1 = await runRetrieval(q1);

        const bestScore1 = out1?.results?.[0]?.score ?? 0;
        const insufficient1 =
          !out1?.ok ||
          !Array.isArray(out1.results) ||
          out1.results.length === 0 ||
          out1.weak === true ||
          (typeof bestScore1 === "number" && bestScore1 < ragMinScore);

        let outFinal = out1;
        if (insufficient1) {
          const rewritten = deterministicRewriteQuery(q1);
          if (rewritten && rewritten !== q1) {
            outFinal = await runRetrieval(rewritten);
          }
        }

        const resultsFinal = Array.isArray(outFinal?.results) ? outFinal.results : [];
        const bestScoreFinal = resultsFinal[0]?.score ?? 0;
        const insufficientFinal =
          !outFinal?.ok ||
          resultsFinal.length === 0 ||
          outFinal.weak === true ||
          (typeof bestScoreFinal === "number" && bestScoreFinal < ragMinScore);

        // If we can't find evidence after 2 retrieval attempts max, refuse to guess.
        let answerText = "";
        let citationOk = false;

        if (insufficientFinal) {
          answerText = isVerbatimRequest(lastUserText)
            ? "I cannot find this exact passage in the uploaded files."
            : "I cannot provide this information because it is not present verbatim in the uploaded documents.";
          citationOk = true;
        } else {
          const allowlist: AllowedChunkRef[] = resultsFinal.map((r: any) => ({
            chunkId: String(r.chunkId || r.id || ""),
            filename: String(r.filename || ""),
            pageStart: r.pageStart,
            pageEnd: r.pageEnd,
          }));

          const ragChunks = resultsFinal.map((r: any) => ({
            chunkId: String(r.chunkId || r.id || ""),
            documentId: String(r.documentId || r.sourceId || ""),
            filename: String(r.filename || ""),
            pageStart: r.pageStart,
            pageEnd: r.pageEnd,
            content: String(r.excerpt || ""),
            score: typeof r.score === "number" ? r.score : 0,
          }));

          const prompt = buildRagPrompt({ question: q1, chunks: ragChunks as any });

          const generateOnce = async (extraInstruction?: string) => {
            const prompt2 = extraInstruction ? `${prompt}\n\n${extraInstruction}\n` : prompt;
            return await ollamaGenerate(prompt2, { baseUrl: ollamaUrl, model, timeoutMs: 45_000 });
          };

          const first = await generateOnce();
          const v1 = validateCitationsAgainstAllowlist({
            text: first,
            allowedChunks: allowlist,
            requireChunkIds: true,
          });

          if (v1.ok) {
            answerText = first;
            citationOk = true;
          } else {
            const retry = await generateOnce(
              "Your previous answer had unverifiable or missing citations. Re-answer using ONLY citations of the form " +
                "[source: <filename> p.<start>-<end> chunk:<chunkId>] and ONLY chunk ids present in the context. " +
                "If you cannot answer from the context, say you can't find it in the uploaded files.",
            );

            const v2 = validateCitationsAgainstAllowlist({
              text: retry,
              allowedChunks: allowlist,
              requireChunkIds: true,
            });

            if (v2.ok) {
              answerText = retry;
              citationOk = true;
            } else {
              answerText =
                "I generated an answer, but I can’t verify that its citations match the retrieved document chunks. " +
                "I won’t guess here. Please specify which file to use (or upload the document) and I’ll try again.";
              citationOk = true;
            }
          }
        }

        if (process.env.NODE_ENV !== "test") {
          const attempts = retrievalAttempts.length;
          const weak = Boolean(outFinal?.weak);
          const bestScore = typeof bestScoreFinal === "number" ? bestScoreFinal : 0;
          console.log(
            `[chat][rag] doc=true attempts=${attempts} weak=${weak} bestScore=${bestScore.toFixed(3)} minScore=${ragMinScore} citations=${citationOk}`,
          );
        }

        // Now that we have a final answer, open SSE and emit tool-call-ish events to preserve UX.
        res.status(200);
        res.setHeader("Content-Type", "text/event-stream");
        res.setHeader("Cache-Control", "no-cache, no-transform");
        res.setHeader("Connection", "keep-alive");
        ;(res as unknown as { flushHeaders?: () => void }).flushHeaders?.();

        res.write(": connected\n\n");

        const toolName = "rag_search_uploads";
        const stream = (async function* (): AsyncGenerator<unknown, void, void> {
          for (let i = 0; i < retrievalAttempts.length; i++) {
            const toolCallId = randomUUID();
            yield {
              type: "tool_call",
              id: requestId,
              model,
              timestamp: Date.now(),
              index: i,
              toolCall: {
                id: toolCallId,
                type: "function",
                function: { name: toolName, arguments: JSON.stringify(retrievalAttempts[i]!.args) },
              },
            };

            const content =
              typeof retrievalAttempts[i]!.result === "string"
                ? retrievalAttempts[i]!.result
                : JSON.stringify(retrievalAttempts[i]!.result);

            yield {
              type: "tool_result",
              id: requestId,
              model,
              timestamp: Date.now(),
              toolCallId,
              content,
            };
          }

          yield {
            type: "content",
            id: requestId,
            model,
            timestamp: Date.now(),
            delta: answerText,
            content: answerText,
            role: "assistant",
          };

          yield {
            type: "done",
            id: requestId,
            model,
            timestamp: Date.now(),
            finishReason: "stop",
          };
        })();

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
          abortController.abort();
          ;(nodeStream as unknown as { destroy: (e: unknown) => void }).destroy(error);
        });

        ;(nodeStream as unknown as { pipe: (r: unknown) => void }).pipe(res);
        return;
      }

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
