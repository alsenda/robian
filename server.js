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
    `OPENAI_API_KEY loaded: ${process.env.OPENAI_API_KEY ? 'yes' : 'no'}`,
  )
})
