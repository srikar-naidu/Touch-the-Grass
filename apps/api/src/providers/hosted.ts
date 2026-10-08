import { ModelProvider, TokenUsage } from './interface';
import { z } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';
import * as Sentry from '@sentry/node';

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

export class HostedProvider implements ModelProvider {
  private baseUrl = process.env.GEMMA_BASE_URL || 'https://generativelanguage.googleapis.com/v1beta';
  private apiKey = process.env.GEMMA_API_KEY || '';
  private textModel = process.env.GEMMA_TEXT_MODEL || 'gemma-2-9b-it';
  private visionModel = process.env.GEMMA_VISION_MODEL || 'gemma-3-12b-it'; // TODO(verify) exact vision model name

  private async fetchGoogleAPI(model: string, contents: any[], schema?: z.ZodSchema, maxRetries = 3) {
    let systemInstruction = undefined;
    if (contents.length > 1 && contents[0].role === 'user' && contents[0].parts[0].text.startsWith('SYSTEM:')) {
      // Extract system instruction for the API
      systemInstruction = {
        parts: [{ text: contents[0].parts[0].text.replace('SYSTEM:', '').trim() }]
      };
      contents.shift();
    }

    const payload: any = {
      contents,
      generationConfig: {
        temperature: 0.7,
      }
    };

    if (systemInstruction) {
      payload.systemInstruction = systemInstruction;
    }

    if (schema) {
      payload.generationConfig.responseMimeType = 'application/json';
      payload.generationConfig.responseSchema = zodToJsonSchema(schema) as any;
    }

    let attempt = 0;
    while (attempt < maxRetries) {
      attempt++;
      try {
        const response = await fetch(`${this.baseUrl}/models/${model}:generateContent?key=${this.apiKey}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });

        if (!response.ok) {
          const err = await response.text();
          if (response.status === 429) {
            await sleep(1000 * Math.pow(2, attempt));
            continue;
          }
          throw new Error(`API Error: ${response.status} ${err}`);
        }

        const data = await response.json();
        const text = data.candidates?.[0]?.content?.parts?.[0]?.text || '{}';
        
        const usage: TokenUsage = {
          promptTokens: data.usageMetadata?.promptTokenCount || 0,
          completionTokens: data.usageMetadata?.candidatesTokenCount || 0,
          totalTokens: data.usageMetadata?.totalTokenCount || 0
        };

        if (!schema) return { text, usage };

        try {
          const parsedJSON = JSON.parse(text);
          const parsed = schema.parse(parsedJSON);
          return { text, parsed, usage };
        } catch (validationError: any) {
          // Schema validation failure retry logic
          if (attempt >= maxRetries) {
            return { text, parsed: undefined, usage }; // Return raw text + flag undefined
          }
          // Append error to user prompt to auto-correct
          payload.contents[payload.contents.length - 1].parts[0].text += `\n\nERROR parsing previous JSON output: ${validationError.message}. Please fix it.`;
        }
      } catch (err: any) {
        if (attempt >= maxRetries) throw err;
        await sleep(1000 * Math.pow(2, attempt));
      }
    }
    throw new Error('Max retries exceeded');
  }

  async generateText(opts: {
    systemPrompt: string;
    userPrompt: string;
    schema?: z.ZodSchema;
    maxTokens?: number;
    temperature?: number;
  }): Promise<{ text: string; parsed?: unknown; usage: TokenUsage }> {
    return await Sentry.startSpan({ name: 'generateText', op: 'ai.generation' }, async () => {
      return this.fetchGoogleAPI(
        this.textModel,
        [
          { role: 'user', parts: [{ text: `SYSTEM: ${opts.systemPrompt}` }] },
          { role: 'user', parts: [{ text: opts.userPrompt }] }
        ],
        opts.schema
      );
    });
  }

  async analyzeImage(opts: {
    systemPrompt: string;
    userPrompt: string;
    imageBase64: string;
    schema?: z.ZodSchema;
    maxTokens?: number;
  }): Promise<{ text: string; parsed?: unknown; usage: TokenUsage }> {
    return await Sentry.startSpan({ name: 'analyzeImage', op: 'ai.vision' }, async () => {
      // Determine mime type from base64 if possible, default to jpeg
      const mimeType = opts.imageBase64.startsWith('data:image/png') ? 'image/png' : 'image/jpeg';
      const cleanBase64 = opts.imageBase64.replace(/^data:image\/\w+;base64,/, '');

      return this.fetchGoogleAPI(
        this.visionModel,
        [
          { role: 'user', parts: [{ text: `SYSTEM: ${opts.systemPrompt}` }] },
          { role: 'user', parts: [
              { text: opts.userPrompt },
              { inlineData: { mimeType, data: cleanBase64 } }
            ] 
          }
        ],
        opts.schema
      );
    });
  }

  async embed(texts: string[]): Promise<number[][]> {
    const embedBaseUrl = process.env.EMBEDDING_BASE_URL || this.baseUrl;
    const embedKey = process.env.EMBEDDING_API_KEY || this.apiKey;
    const embedModel = process.env.EMBEDDING_MODEL || 'text-embedding-004';
    
    const results: number[][] = [];
    
    for (const text of texts) {
      const response = await fetch(`${embedBaseUrl}/models/${embedModel}:embedContent?key=${embedKey}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: `models/${embedModel}`,
          content: { parts: [{ text }] }
        })
      });

      if (!response.ok) throw new Error('Embed API Error');
      const data = await response.json();
      results.push(data.embedding.values);
    }
    
    return results;
  }
}
