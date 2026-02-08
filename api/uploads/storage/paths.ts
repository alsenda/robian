import path from "node:path";

export function getUploadsRootDir(): string {
  const configured = process.env.UPLOADS_DIR;
  if (configured) { return path.resolve(configured); }
  return path.resolve(process.cwd(), ".data", "uploads");
}

export function getManifestPath(): string {
  return path.join(getUploadsRootDir(), "manifest.json");
}

export function safeJoin(rootDir: string, ...parts: string[]): string {
  const full = path.resolve(rootDir, ...parts);
  const root = path.resolve(rootDir) + path.sep;
  if (!full.startsWith(root)) {
    throw new Error("Path traversal blocked");
  }
  return full;
}
