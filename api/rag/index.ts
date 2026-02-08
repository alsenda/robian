import type { RagService } from './types.ts'
import { createStubRagService } from './ragService.stub.ts'

export interface RagServiceConfig {
  provider?: 'stub'
}

export function createRagService(config?: RagServiceConfig): RagService {
  const provider = process.env.RAG_PROVIDER ?? config?.provider ?? 'stub'

  switch (provider) {
    case 'stub':
    default:
      return createStubRagService()
  }
}
