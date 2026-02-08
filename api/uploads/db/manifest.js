// @ts-check

import fsp from 'node:fs/promises'

import { getManifestPath, getUploadsRootDir } from '../storage/paths.js'

/**
 * @typedef {Object} ManifestEntry
 * @property {string} id
 * @property {string} originalName
 * @property {string} storedName
 * @property {string} mimeType
 * @property {number} sizeBytes
 * @property {string} createdAt
 * @property {string} sha256
 * @property {string} extension
 * @property {boolean} extractable
 * @property {string} previewText
 */

/** @typedef {{ uploads: ManifestEntry[] }} Manifest */

async function ensureManifestFile() {
  const dir = getUploadsRootDir()
  await fsp.mkdir(dir, { recursive: true })
  const manifestPath = getManifestPath()
  try {
    await fsp.access(manifestPath)
  } catch {
    await fsp.writeFile(manifestPath, JSON.stringify({ uploads: [] }, null, 2), 'utf8')
  }
  return manifestPath
}

async function readManifest() {
  const manifestPath = await ensureManifestFile()
  const raw = await fsp.readFile(manifestPath, 'utf8')
  try {
    /** @type {unknown} */
    const parsedUnknown = JSON.parse(raw)
    /** @type {any} */
    const parsed = parsedUnknown
    /** @type {ManifestEntry[]} */
    const uploads = Array.isArray(parsed?.uploads) ? parsed.uploads : []
    return { uploads }
  } catch {
    return { uploads: [] }
  }
}

/** @param {Manifest} manifest */
async function writeManifest(manifest) {
  const manifestPath = await ensureManifestFile()
  const tmpPath = `${manifestPath}.tmp`
  await fsp.writeFile(tmpPath, JSON.stringify(manifest, null, 2), 'utf8')
  await fsp.rename(tmpPath, manifestPath)
}

export async function listManifestEntries() {
  const { uploads } = await readManifest()
  return [...uploads].sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))
}

/** @param {string} id */
export async function getManifestEntry(id) {
  const { uploads } = await readManifest()
  return uploads.find((u) => u.id === id) || null
}

/** @param {ManifestEntry} entry */
export async function addManifestEntry(entry) {
  /** @type {Manifest} */
  const manifest = await readManifest()
  const without = manifest.uploads.filter((u) => u.id !== entry.id)
  manifest.uploads = [entry, ...without]
  await writeManifest(manifest)
}

/** @param {string} id */
export async function deleteManifestEntry(id) {
  /** @type {Manifest} */
  const manifest = await readManifest()
  manifest.uploads = manifest.uploads.filter((u) => u.id !== id)
  await writeManifest(manifest)
}
