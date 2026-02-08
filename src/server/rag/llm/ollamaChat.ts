export interface ChatOptions { model?: string; baseUrl?: string; timeoutMs?: number; }

function sanitizeBaseUrl(url: string): string {
  return String(url || "").trim().replace(/\/+$/, "");
}

function toOneLine(input: string): string {
  return String(input || "")
    .replace(/[\r\n\t]+/g, " ")
    .replace(/\s{2,}/g, " ")
    .trim();
}

function describeResponseBody(body: unknown): string {
  try {
    return toOneLine(JSON.stringify(body));
  } catch {
    return "";
  }
}

function resolveOptions(opts?: ChatOptions): { model: string; baseUrl: string; timeoutMs: number } {
  const baseUrl = sanitizeBaseUrl(
    opts?.baseUrl ?? process.env.OLLAMA_BASE_URL ?? process.env.OLLAMA_URL ?? "http://127.0.0.1:11434",
  );

  const model = String(
    opts?.model ??
      process.env.OLLAMA_CHAT_MODEL ??
      process.env.OLLAMA_MODEL ??
      "llama3.1",
  ).trim();

  const timeoutMsRaw = opts?.timeoutMs ?? 30_000;
  const timeoutMs = Number.isFinite(timeoutMsRaw) && (timeoutMsRaw as number) > 0
    ? Math.floor(timeoutMsRaw as number)
    : 30_000;

  return { model, baseUrl, timeoutMs };
}

export async function chat(prompt: string, opts?: ChatOptions): Promise<string> {
  const preparedPrompt = String(prompt ?? "").trim();
  if (!preparedPrompt) { throw new Error("chat requires a non-empty prompt"); }

  const { baseUrl, model, timeoutMs } = resolveOptions(opts);
  if (!baseUrl) { throw new Error("OLLAMA_BASE_URL is empty"); }
  if (!model) { throw new Error("OLLAMA_CHAT_MODEL is empty"); }

  const abortController = new AbortController();
  const timeout = setTimeout(() => abortController.abort(), timeoutMs);

  try {
    const resp = await fetch(`${baseUrl}/api/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model,
        prompt: preparedPrompt,
        stream: false,
        options: {
          temperature: 0,
        },
      }),
      signal: abortController.signal,
    });

    const json: unknown = await resp.json().catch(() => null);
    if (!resp.ok) {
      const suffix = json ? ` body=${describeResponseBody(json)}` : "";
      throw new Error(`Ollama chat request failed (HTTP ${resp.status}) for model "${model}".${suffix}`);
    }

    const responseText =
      json && typeof json === "object"
        ? (json as { response?: unknown }).response
        : undefined;

    if (typeof responseText !== "string") {
      throw new Error(`Ollama /api/generate did not return a text response for model "${model}"`);
    }

    return responseText.trim();
  } catch (error: unknown) {
    if (abortController.signal.aborted) {
      throw new Error(`Ollama chat request timed out after ${timeoutMs}ms (model "${model}")`);
    }
    if (error instanceof Error) { throw error; }
    throw new Error(`Ollama chat failed: ${String(error ?? "unknown error")}`);
  } finally {
    clearTimeout(timeout);
  }
}
