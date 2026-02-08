import type express from "express";

import { createOllamaEmbeddingsService } from "../embeddings/ollamaEmbeddings.ts";
import type { EmbeddingsError } from "../embeddings/types.ts";

import { openSqliteDb } from "./sqlite/db.ts";

export interface RagHealthResponse {
  ok: boolean;
  provider: string;
  dbPath?: string;
  embedModel?: string;
  error?: { kind: string; message: string };
}

interface CachedEmbeddingsProbe {
  atMs: number;
  value: { ok: true } | { ok: false; error: EmbeddingsError };
}

let embeddingsProbeCache: Map<string, CachedEmbeddingsProbe> | null = null;
let embeddingsProbeInflight: Map<string, Promise<CachedEmbeddingsProbe["value"]>> | null = null;

function nowMs(): number {
  return Date.now();
}

function asErrorPayload(error: unknown): { kind: string; message: string } {
  if (error && typeof error === "object") {
    const kind = (error as { kind?: unknown }).kind;
    const message = (error as { message?: unknown }).message;
    if (typeof kind === "string" && typeof message === "string") {
      return { kind, message };
    }
  }

  if (error instanceof Error) {
    return { kind: "unknown", message: error.message || "Unknown error" };
  }

  return { kind: "unknown", message: "Unknown error" };
}

function parseIntEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  const n = raw ? Number(raw) : NaN;
  return Number.isFinite(n) ? Math.floor(n) : fallback;
}

function getProvider(): "stub" | "sqlite" {
  const p = String(process.env.RAG_PROVIDER || "sqlite").trim().toLowerCase();
  return p === "stub" ? "stub" : "sqlite";
}

function getDbPathConfigured(): string {
  return String(process.env.RAG_DB_PATH || "").trim();
}

function getOllamaUrl(): string {
  return String(process.env.OLLAMA_URL || "http://localhost:11434").trim().replace(/\/+$/, "");
}

function getEmbedModel(): string {
  return String(process.env.OLLAMA_EMBED_MODEL || "robian:latest").trim();
}

async function probeSqliteDb(dbPath: string): Promise<{ ok: true } | { ok: false; error: { kind: string; message: string } }> {
  try {
    const db = openSqliteDb(dbPath);
    try {
      db.close();
    } catch {
      // ignore
    }
    return { ok: true };
  } catch {
    return {
      ok: false,
      error: {
        kind: "db_unavailable",
        message:
          "RAG storage is unavailable. Check RAG_DB_PATH, file permissions, and that SQLite can open the database.",
      },
    };
  }
}

async function probeEmbeddingsCached(args: {
  ollamaUrl: string
  model: string
  timeoutMs: number
  ttlMs: number,
}): Promise<{ ok: true } | { ok: false; error: EmbeddingsError }> {
  const cacheKey = `${args.ollamaUrl}::${args.model}`;
  if (!embeddingsProbeCache) { embeddingsProbeCache = new Map(); }
  if (!embeddingsProbeInflight) { embeddingsProbeInflight = new Map(); }

  const cached = embeddingsProbeCache.get(cacheKey);
  if (cached && nowMs() - cached.atMs < args.ttlMs) { return cached.value; }

  const inflight = embeddingsProbeInflight.get(cacheKey);
  if (inflight) { return inflight; }

  const p = (async () => {
    try {
      const svc = createOllamaEmbeddingsService({
        ollamaUrl: args.ollamaUrl,
        model: args.model,
        timeoutMs: args.timeoutMs,
      });

      // Requirement: call embedText('ping')
      const vec = await svc.embedText("ping", 64);
      const ok = Array.isArray(vec) && vec.length > 0 && vec.every((n) => typeof n === "number" && Number.isFinite(n));
      if (!ok) {
        return {
          ok: false,
          error: {
            kind: "invalid_response",
            message: "Embeddings returned an invalid vector",
          },
        } satisfies { ok: false; error: EmbeddingsError };
      }
      return { ok: true } as const;
    } catch (error: unknown) {
      const payload = asErrorPayload(error);
      return { ok: false, error: { kind: payload.kind, message: payload.message } };
    }
  })();

  embeddingsProbeInflight.set(cacheKey, p);
  try {
    const value = await p;
    embeddingsProbeCache.set(cacheKey, { atMs: nowMs(), value });
    return value;
  } finally {
    embeddingsProbeInflight.delete(cacheKey);
  }
}

export function createRagHealthHandler(): express.RequestHandler {
  return async (_req, res) => {
    const provider = getProvider();
    const dbPath = getDbPathConfigured();
    const embedModel = getEmbedModel();

    if (provider === "stub") {
      const out: RagHealthResponse = {
        ok: false,
        provider,
        error: { kind: "stubbed", message: "RAG is stubbed. Set RAG_PROVIDER=sqlite." },
      };
      return res.status(200).json(out);
    }

    const dbHealth = await probeSqliteDb(dbPath);
    if (!dbHealth.ok) {
      const out: RagHealthResponse = {
        ok: false,
        provider,
        dbPath,
        embedModel,
        error: dbHealth.error,
      };
      return res.status(200).json(out);
    }

    const timeoutMs = parseIntEnv("RAG_HEALTH_EMBED_TIMEOUT_MS", 1500);
    const ttlMs = parseIntEnv("RAG_HEALTH_CACHE_MS", 30_000);
    const embedHealth = await probeEmbeddingsCached({
      ollamaUrl: getOllamaUrl(),
      model: embedModel,
      timeoutMs,
      ttlMs,
    });

    if (!embedHealth.ok) {
      const out: RagHealthResponse = {
        ok: false,
        provider,
        dbPath,
        embedModel,
        error: { kind: embedHealth.error.kind, message: embedHealth.error.message },
      };
      return res.status(200).json(out);
    }

    const out: RagHealthResponse = {
      ok: true,
      provider,
      dbPath,
      embedModel,
    };
    return res.status(200).json(out);
  };
}
