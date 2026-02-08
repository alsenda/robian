import fsp from "node:fs/promises";

import { getManifestPath, getUploadsRootDir } from "../storage/paths.ts";

export interface ManifestEntry {
  id: string;
  originalName: string;
  storedName: string;
  mimeType: string;
  sizeBytes: number;
  createdAt: string;
  sha256: string;
  extension: string;
  extractable: boolean;
  previewText: string;
}

interface Manifest { uploads: ManifestEntry[]; }

async function ensureManifestFile(): Promise<string> {
  const dir = getUploadsRootDir();
  await fsp.mkdir(dir, { recursive: true });
  const manifestPath = getManifestPath();
  try {
    await fsp.access(manifestPath);
  } catch {
    await fsp.writeFile(manifestPath, JSON.stringify({ uploads: [] }, null, 2), "utf8");
  }
  return manifestPath;
}

async function readManifest(): Promise<Manifest> {
  const manifestPath = await ensureManifestFile();
  const raw = await fsp.readFile(manifestPath, "utf8");
  try {
    const parsedUnknown: unknown = JSON.parse(raw);
    const parsed = parsedUnknown as any;
    const uploads: ManifestEntry[] = Array.isArray(parsed?.uploads) ? parsed.uploads : [];
    return { uploads };
  } catch {
    return { uploads: [] };
  }
}

async function writeManifest(manifest: Manifest): Promise<void> {
  const manifestPath = await ensureManifestFile();
  const tmpPath = `${manifestPath}.tmp`;
  await fsp.writeFile(tmpPath, JSON.stringify(manifest, null, 2), "utf8");
  await fsp.rename(tmpPath, manifestPath);
}

export async function listManifestEntries(): Promise<ManifestEntry[]> {
  const { uploads } = await readManifest();
  return [...uploads].sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
}

export async function getManifestEntry(id: string): Promise<ManifestEntry | null> {
  const { uploads } = await readManifest();
  return uploads.find((u) => u.id === id) || null;
}

export async function addManifestEntry(entry: ManifestEntry): Promise<void> {
  const manifest = await readManifest();
  const without = manifest.uploads.filter((u) => u.id !== entry.id);
  manifest.uploads = [entry, ...without];
  await writeManifest(manifest);
}

export async function deleteManifestEntry(id: string): Promise<void> {
  const manifest = await readManifest();
  manifest.uploads = manifest.uploads.filter((u) => u.id !== id);
  await writeManifest(manifest);
}
