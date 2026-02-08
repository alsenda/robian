export type EmbeddingVector = number[];

export interface EmbeddingsError {
  kind: string;
  message: string;
}

export interface EmbeddingsService {
  embedText(input: string, maxChars?: number): Promise<EmbeddingVector>;
}
