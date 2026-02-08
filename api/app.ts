import express from 'express'
import cors from 'cors'

import { createHandleChat } from './chat/index.ts'
import { createUploadsRouter } from './uploads/index.ts'
import { createRagService } from './rag/index.ts'
import { createRagHealthHandler } from './rag/health.ts'

export function createApp(): express.Express {
  const app = express()

  app.use(cors())
  app.use(express.json())

  const ragService = createRagService()

  // RAG health/status endpoint (read-only)
  app.get('/api/rag/health', createRagHealthHandler())

  // Chat endpoint (existing behavior)
  app.post('/api/chat', createHandleChat({ ragService }))

  // Uploads feature
  app.use('/api/uploads', createUploadsRouter({ rag: ragService }))

  return app
}
