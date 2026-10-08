import { z } from 'zod';

export interface TokenUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

export interface ModelProvider {
  generateText(opts: {
    systemPrompt: string;
    userPrompt: string;
    schema?: z.ZodSchema;
    maxTokens?: number;
    temperature?: number;
  }): Promise<{ text: string; parsed?: unknown; usage: TokenUsage }>;

  analyzeImage(opts: {
    systemPrompt: string;
    userPrompt: string;
    imageBase64: string;
    schema?: z.ZodSchema;
    maxTokens?: number;
  }): Promise<{ text: string; parsed?: unknown; usage: TokenUsage }>;

  embed(texts: string[]): Promise<number[][]>;
}
