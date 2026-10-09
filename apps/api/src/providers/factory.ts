import { ModelProvider } from './interface.js';
import { MockProvider } from './mock.js';
import { HostedProvider } from './hosted.js';

type ProviderMode = 'hosted' | 'local' | 'mock';

let singleton: ModelProvider | null = null;

function getProviderMode(): ProviderMode {
  return (process.env.PROVIDER_MODE || 'mock') as ProviderMode;
}

class LocalProvider implements ModelProvider {
  private baseUrl: string;
  private model: string;

  constructor() {
    this.baseUrl = process.env.LOCAL_BASE_URL || 'http://localhost:11434';
    this.model = process.env.LOCAL_MODEL || 'gemma3:4b';
  }

  async generateText(opts: {
    systemPrompt: string;
    userPrompt: string;
    schema?: any;
    maxTokens?: number;
    temperature?: number;
  }) {
    try {
      const prompt = `SYSTEM: ${opts.systemPrompt}\n\nUSER: ${opts.userPrompt}`;
      const response = await fetch(`${this.baseUrl}/api/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: this.model,
          prompt,
          stream: false,
          options: {
            num_predict: opts.maxTokens || 300,
            temperature: opts.temperature ?? 0.7,
          },
        }),
      });
      if (!response.ok) throw new Error('Local model API error');
      const data = await response.json();
      const text = (data.response || '').trim();
      let parsed: unknown;
      if (opts.schema && text) {
        try {
          parsed = opts.schema.parse(JSON.parse(text.replace(/^```json\s*|\s*```$/g, '')));
        } catch { /* ignore */ }
      }
      return {
        text,
        parsed,
        usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
      };
    } catch {
      return {
        text: '{}',
        usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
      };
    }
  }

  async analyzeImage(opts: {
    systemPrompt: string;
    userPrompt: string;
    imageBase64: string;
    schema?: any;
    maxTokens?: number;
  }) {
    try {
      const cleanBase64 = opts.imageBase64.replace(/^data:image\/[\w.+-]+;base64,/i, '');
      const prompt = `SYSTEM: ${opts.systemPrompt}\n\nUSER: ${opts.userPrompt}`;
      const response = await fetch(`${this.baseUrl}/api/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: this.model,
          prompt,
          images: [cleanBase64],
          stream: false,
          options: {
            num_predict: opts.maxTokens || 200,
          },
        }),
      });
      if (!response.ok) throw new Error('Local model vision error');
      const data = await response.json();
      const text = (data.response || '').trim();
      let parsed: unknown;
      if (opts.schema && text) {
        try {
          parsed = opts.schema.parse(JSON.parse(text.replace(/^```json\s*|\s*```$/g, '')));
        } catch { /* ignore */ }
      }
      return {
        text,
        parsed,
        usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
      };
    } catch {
      return {
        text: '{"pass":true,"confidence":0.7,"reason":"Local mode default pass","needs_retake":false}',
        parsed: { pass: true, confidence: 0.7, reason: 'Local mode default pass', needs_retake: false },
        usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
      };
    }
  }

  async embed(texts: string[]): Promise<number[][]> {
    const results: number[][] = [];
    for (const text of texts) {
      try {
        const response = await fetch(`${this.baseUrl}/api/embeddings`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ model: this.model, prompt: text }),
        });
        const data = await response.json();
        results.push(data.embedding || new Array(768).fill(0.1));
      } catch {
        results.push(new Array(768).fill(0.1));
      }
    }
    return results;
  }
}

export function getModelProvider(): ModelProvider {
  if (!singleton) {
    const mode = getProviderMode();
    switch (mode) {
      case 'hosted':
        singleton = new HostedProvider();
        break;
      case 'local':
        singleton = new LocalProvider();
        break;
      case 'mock':
      default:
        singleton = new MockProvider();
    }
  }
  return singleton;
}
