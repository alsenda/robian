import type { RagService } from './types.js'
import { createStubRagService } from './ragService.stub.js'

export interface CreateRagServiceConfig {
  implementation?: 'stub'
}

export function createRagService(config: CreateRagServiceConfig = {}): RagService {
  const impl = config.implementation ?? (process.env.RAG_IMPLEMENTATION as string | undefined) ?? 'stub'

  switch (impl) {
    case 'stub':
    default:
      return createStubRagService()
  }
}

export type * from './types.js'
