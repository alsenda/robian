import 'dotenv/config'
import express from 'express'
import cors from 'cors'
import { handleChat } from './api/chat/index.js'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const app = express()
const port = 3001

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

app.use(cors())
app.use(express.json())

// Chat endpoint
app.post('/api/chat', handleChat)

// Serve built frontend (Tailwind styles included) when running production builds.
// This keeps dev flow via Vite unchanged.
if (process.env.NODE_ENV === 'production') {
  const distDir = path.join(__dirname, 'dist')
  app.use(express.static(distDir))
  app.get('*', (req, res) => {
    res.sendFile(path.join(distDir, 'index.html'))
  })
}

app.listen(port, () => {
  console.log(`API server running at http://localhost:${port}`)
  console.log(
    `OLLAMA_URL: ${(process.env.OLLAMA_URL || 'http://localhost:11434').replace(/\/+$/, '')}`,
  )
  console.log(`OLLAMA_MODEL: ${process.env.OLLAMA_MODEL || 'llama3.2:latest'}`)
})
