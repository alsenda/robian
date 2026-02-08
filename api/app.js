import express from 'express'
import cors from 'cors'

import { handleChat } from './chat/index.js'
import { uploadsRouter } from './uploads/index.js'

export function createApp() {
  const app = express()

  app.use(cors())
  app.use(express.json())

  // Chat endpoint (existing behavior)
  app.post('/api/chat', handleChat)

  // Uploads feature
  app.use('/api/uploads', uploadsRouter)

  return app
}
