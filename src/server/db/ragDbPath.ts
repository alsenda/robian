import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";

let memoizedTestDbPath: string | null = null;

function isTestEnv(): boolean {
  return process.env.NODE_ENV === "test" || Boolean(process.env.VITEST);
}

function resolveToAbsolute(p: string): string {
  const trimmed = String(p || "").trim();
  if (!trimmed) { return ""; }
  return path.isAbsolute(trimmed) ? trimmed : path.resolve(process.cwd(), trimmed);
}

export function getDefaultDevProdRagDbPath(): string {
  return resolveToAbsolute("data/rag.sqlite");
}

export function getRagDbPath(): string {
  const configuredRaw = String(process.env.RAG_DB_PATH || "").trim();
  const configuredAbs = configuredRaw ? resolveToAbsolute(configuredRaw) : "";
  const defaultAbs = getDefaultDevProdRagDbPath();

  if (isTestEnv()) {
    if (configuredAbs) {
      if (path.normalize(configuredAbs).toLowerCase() === path.normalize(defaultAbs).toLowerCase()) {
        throw new Error(
          `Refusing to use dev/prod RAG DB path in tests. Got RAG_DB_PATH=${configuredRaw}. ` +
            `Tests must use a temp DB file, never ${path.relative(process.cwd(), defaultAbs)}`,
        );
      }
      return configuredAbs;
    }

    if (!memoizedTestDbPath) {
      const fileName = `robian-rag.vitest-${randomUUID()}.sqlite`;
      memoizedTestDbPath = path.join(os.tmpdir(), fileName);
    }
    return memoizedTestDbPath;
  }

  return configuredAbs || defaultAbs;
}
