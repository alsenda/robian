import 'dotenv/config'
import express from 'express'
import cors from 'cors'
import { handleChat } from './api/chat.js'

const app = express()
const port = 3001

app.use(cors())
app.use(express.json())

// Chat endpoint
app.post('/api/chat', handleChat)

app.listen(port, () => {
  console.log(`API server running at http://localhost:${port}`)
  console.log(
    `OLLAMA_URL: ${(process.env.OLLAMA_URL || 'http://localhost:11434').replace(/\/+$/, '')}`,
  )
  console.log(`OLLAMA_MODEL: ${process.env.OLLAMA_MODEL || 'llama3.2:latest'}`)
})
