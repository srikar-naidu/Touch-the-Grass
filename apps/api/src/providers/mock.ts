import { ModelProvider, TokenUsage } from './interface.js';
import { z } from 'zod';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

export class MockProvider implements ModelProvider {
  async generateText(opts: {
    systemPrompt: string;
    userPrompt: string;
    schema?: z.ZodSchema;
    maxTokens?: number;
    temperature?: number;
  }): Promise<{ text: string; parsed?: unknown; usage: TokenUsage }> {
    // If it's the challenge writer prompt
    if (opts.systemPrompt.includes('Touch Grass challenge writer')) {
      const filePath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../fixtures/responses/challenge-writer.json');
      let data: any;
      try {
        const fileContent = fs.readFileSync(filePath, 'utf-8');
        data = JSON.parse(fileContent);
      } catch (e) {
        void e;
        // Fallback if running from a different cwd or file missing
        data = {
          title: "Mock Challenge",
          description: "This is a mock challenge because the fixture couldn't be loaded.",
          category: "nature",
          difficulty: 1,
          socialLevel: 0,
          estimatedMinutes: 5,
          proofType: "photo",
          proofRubric: "Any photo of outside.",
          safetyNotes: "Stay safe.",
          locationHint: null,
          tags: ["mock", "outdoors"]
        };
      }
      
      const parsed = opts.schema ? opts.schema.parse(data) : data;
      return {
        text: JSON.stringify(data),
        parsed,
        usage: { promptTokens: 10, completionTokens: 50, totalTokens: 60 }
      };
    }
    
    // Safety check mock
    if (opts.systemPrompt.includes('safety reviewer')) {
      return {
        text: '{"safe":true,"reason":"Mock safe"}',
        parsed: { safe: true, reason: 'Mock safe' },
        usage: { promptTokens: 10, completionTokens: 10, totalTokens: 20 }
      };
    }

    return {
      text: '{}',
      usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 }
    };
  }

  async analyzeImage(_opts: {
    systemPrompt: string;
    userPrompt: string;
    imageBase64: string;
    schema?: z.ZodSchema;
    maxTokens?: number;
  }): Promise<{ text: string; parsed?: unknown; usage: TokenUsage }> {
    return {
      text: '{"pass":true,"confidence":0.9,"reason":"Looks good!","needs_retake":false}',
      parsed: { pass: true, confidence: 0.9, reason: "Looks good!", needs_retake: false },
      usage: { promptTokens: 10, completionTokens: 20, totalTokens: 30 }
    };
  }

  async embed(texts: string[]): Promise<number[][]> {
    return texts.map(() => new Array(768).fill(0.1));
  }
}
