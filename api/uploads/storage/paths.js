// @ts-check

import path from 'node:path'

export function getUploadsRootDir() {
  const configured = process.env.UPLOADS_DIR
  if (configured) return path.resolve(configured)
  return path.resolve(process.cwd(), '.data', 'uploads')
}

export function getManifestPath() {
  return path.join(getUploadsRootDir(), 'manifest.json')
}

/**
 * @param {string} rootDir
 * @param {...string} parts
 */
export function safeJoin(rootDir, ...parts) {
  const full = path.resolve(rootDir, ...parts)
  const root = path.resolve(rootDir) + path.sep
  if (!full.startsWith(root)) {
    throw new Error('Path traversal blocked')
  }
  return full
}
