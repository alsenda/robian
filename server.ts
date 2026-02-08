import 'dotenv/config'
import express from 'express'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { createApp } from './api/app.ts'

const app = createApp()
const port = 3001

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

// Serve built frontend (Tailwind styles included) when running production builds.
// This keeps dev flow via Vite unchanged.
if (process.env.NODE_ENV === 'production') {
  const distDir = path.join(__dirname, 'dist')
  app.use(express.static(distDir))
  app.get('*', (_req, res) => {
    res.sendFile(path.join(distDir, 'index.html'))
  })
}

app.listen(port, () => {
  console.log(`API server running at http://localhost:${port}`)
  console.log(
    `OLLAMA_URL: ${(process.env.OLLAMA_URL || 'http://localhost:11434').replace(/\/+$/, '')}`,
  )
  console.log(`OLLAMA_MODEL: ${process.env.OLLAMA_MODEL || 'robian:latest'}`)
})
