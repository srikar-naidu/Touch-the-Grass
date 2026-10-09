import { z } from 'zod';
import { Challenge, AppEvent } from '../db/interface.js';
import { ModelProvider } from '../providers/interface.js';
import * as Sentry from '@sentry/node';

const ReflectionSchema = z.object({
  summary: z.string().min(3).max(500),
  moodBefore: z.number().int().min(1).max(5).nullable(),
  moodAfter: z.number().int().min(1).max(5).nullable(),
  tags: z.array(z.string()).max(10),
});

export interface ReflectionInput {
  challengeId: string;
  userId: string;
  voiceBase64?: string;
  textInput?: string;
}

export interface ReflectionOutput {
  summary: string;
  moodBefore: number | null;
  moodAfter: number | null;
  tags: string[];
}

async function transcribeVoice(voiceBase64: string, provider: ModelProvider): Promise<string | null> {
  const apiKey = process.env.ELEVENLABS_API_KEY;
  if (!apiKey) return null;
  try {
    const cleanBase64 = voiceBase64.replace(/^data:audio\/[\w.+-]+;base64,/i, '');
    const response = await fetch('https://api.elevenlabs.io/v1/audio/transcriptions', {
      method: 'POST',
      headers: {
        'xi-api-key': apiKey,
      },
      body: (() => {
        const buf = Buffer.from(cleanBase64, 'base64');
        const fd = new FormData();
        const blob = new Blob([buf], { type: 'audio/webm' });
        fd.append('file', blob, 'voice.webm');
        fd.append('model_id', 'eleven_multilingual_v2');
        return fd as unknown as BodyInit;
      })(),
      signal: AbortSignal.timeout(60_000),
    });
    if (!response.ok) return null;
    const data = await response.json() as any;
    return data.text || null;
  } catch {
    return null;
  }
}

export async function runReflection(
  input: ReflectionInput,
  provider: ModelProvider,
  challenge: Challenge,
  deps: {
    saveChallenge: (c: Challenge) => Promise<void>;
    logEvent: (e: AppEvent) => Promise<void>;
  },
): Promise<ReflectionOutput> {
  return Sentry.startSpan({ name: 'reflection-workflow', op: 'workflow' }, async (span) => {
    span?.setAttribute('hasVoice', !!input.voiceBase64);
    span?.setAttribute('hasText', !!input.textInput);

    let transcript: string | null = null;
    if (input.voiceBase64) {
      transcript = await transcribeVoice(input.voiceBase64, provider);
    }
    const rawText = transcript || input.textInput || '';

    let output: ReflectionOutput;
    if (rawText.trim()) {
      const systemPrompt = `You are summarizing a user's evening reflection on an outdoor challenge they completed.
Extract:
1. A concise, warm summary of what they wrote (max 2 sentences).
2. moodBefore: how they felt BEFORE the challenge (1=bad, 5=great) — infer from context if not stated.
3. moodAfter: how they felt AFTER the challenge (1-5) — infer from context.
4. Up to 5 short descriptive tags (e.g., "refreshing", "calm", "exhausting", "fun").
Be generous and kind. If you can't infer moods, leave them as null.
Respond ONLY with valid JSON matching the schema.`;

      const userPrompt = `Challenge context:
Title: ${challenge.title}
Category: ${challenge.category}
Difficulty: ${challenge.difficulty}

User's reflection:
"""
${rawText.slice(0, 2000)}
"""`;

      try {
        const res = await provider.generateText({
          systemPrompt,
          userPrompt,
          schema: ReflectionSchema,
          maxTokens: 250,
          temperature: 0.5,
        });
        if (res.parsed) {
          output = ReflectionSchema.parse(res.parsed);
        } else {
          throw new Error('No parsed response');
        }
      } catch {
        output = {
          summary: rawText.slice(0, 500),
          moodBefore: null,
          moodAfter: null,
          tags: ['reflection'],
        };
      }
    } else {
      output = {
        summary: challenge.status === 'completed'
          ? 'Completed without a written reflection.'
          : '',
        moodBefore: null,
        moodAfter: null,
        tags: [],
      };
    }

    challenge.reflection = {
      summary: output.summary || null,
      moodBefore: output.moodBefore,
      moodAfter: output.moodAfter,
      tags: output.tags,
    };
    await deps.saveChallenge(challenge);

    await deps.logEvent({
      ts: new Date(),
      userId: input.userId,
      challengeId: input.challengeId,
      eventType: 'reflection',
      category: challenge.category,
      difficulty: challenge.difficulty,
      socialLevel: challenge.socialLevel,
      moodBefore: output.moodBefore ?? undefined,
      moodAfter: output.moodAfter ?? undefined,
    });

    return output;
  });
}
