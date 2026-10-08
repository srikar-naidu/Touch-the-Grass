import { afterEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { HostedProvider } from './hosted.js';

const resultSchema = z.object({
  pass: z.boolean(),
  confidence: z.number().min(0).max(1),
});

describe('HostedProvider', () => {
  afterEach(() => vi.restoreAllMocks());

  it('sends vision input and validates structured JSON output', async () => {
    process.env.GEMMA_API_KEY = 'test-key';
    process.env.GEMMA_VISION_MODEL = 'gemma-vision-test';
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({
      candidates: [{ content: { parts: [{ text: '{"pass":true,"confidence":0.9}' }] } }],
      usageMetadata: { promptTokenCount: 12, candidatesTokenCount: 8, totalTokenCount: 20 },
    }), { status: 200 }));

    const response = await new HostedProvider().analyzeImage({
      systemPrompt: 'Verify the image.',
      userPrompt: 'Does it match?',
      imageBase64: 'data:image/png;base64,ZmFrZQ==',
      schema: resultSchema,
      maxTokens: 150,
    });

    expect(response.parsed).toEqual({ pass: true, confidence: 0.9 });
    const request = JSON.parse(String(fetchMock.mock.calls[0][1]?.body));
    expect(fetchMock.mock.calls[0][0]).toContain('/models/gemma-vision-test:generateContent');
    expect(fetchMock.mock.calls[0][1]?.headers).toMatchObject({ 'x-goog-api-key': 'test-key' });
    expect(request.contents[0].parts[1].inlineData).toEqual({ mimeType: 'image/png', data: 'ZmFrZQ==' });
    expect(request.generationConfig.responseMimeType).toBe('application/json');
    expect(request.generationConfig.responseSchema.$schema).toBeUndefined();
    expect(request.generationConfig.maxOutputTokens).toBe(150);
  });

  it('retries malformed structured output with validation feedback', async () => {
    const responses = [
      { candidates: [{ content: { parts: [{ text: '{"pass":"yes"}' }] } }] },
      { candidates: [{ content: { parts: [{ text: '{"pass":false,"confidence":0.2}' }] } }] },
    ];
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async () =>
      new Response(JSON.stringify(responses.shift()), { status: 200 })
    );

    const response = await new HostedProvider().generateText({
      systemPrompt: 'Return JSON.',
      userPrompt: 'Answer.',
      schema: resultSchema,
    });

    expect(response.parsed).toEqual({ pass: false, confidence: 0.2 });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const secondRequest = JSON.parse(String(fetchMock.mock.calls[1][1]?.body));
    expect(secondRequest.contents.at(-1).parts[0].text).toContain('ERROR parsing previous JSON output');
  });
});
