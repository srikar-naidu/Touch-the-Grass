import { ModelProvider } from '../providers/interface.js';
import { Challenge, AppEvent } from '../db/interface.js';
import { z } from 'zod';
import * as Sentry from '@sentry/node';

const VerificationSchema = z.object({
  pass: z.boolean(),
  confidence: z.number().min(0).max(1),
  reason: z.string().min(3).max(400),
  needs_retake: z.boolean(),
});

const StravaExtractSchema = z.object({
  activityType: z.string().optional(),
  distance: z.string().optional(),
  duration: z.string().optional(),
  date: z.string().optional(),
});

export interface VerifyInput {
  challengeId: string;
  userId: string;
  proofType: 'photo' | 'strava_screenshot' | 'voice_note' | 'honor';
  imageBase64?: string;
  voiceBase64?: string;
  honorConfirm?: boolean;
  extractedData?: Record<string, any>;
  screenSeconds?: number;
}

export interface VerifyOutput {
  pass: boolean;
  confidence: number;
  reason: string;
  needsRetake: boolean;
  honorSystem: boolean;
  extractedData?: {
    activityType?: string;
    distance?: string;
    duration?: string;
    date?: string;
  };
  attempts: number;
  challengeId: string;
  status: 'completed' | 'failed';
}

const VERIFY_SYSTEM_PROMPT = `You are a proof verifier for the Touch Grass outdoor challenge app. You are given a photo and a rubric describing what the photo should show to prove challenge completion.

RULES:
- Judge ONLY based on the rubric. Does the photo show what the rubric requires?
- Be generous but honest. The person went outside and tried — give credit where due.
- confidence: 0.0-1.0. Use 0.8+ for clear matches, 0.4-0.6 for ambiguous, <0.4 for mismatches.
- needs_retake: true ONLY if the photo is blurry, dark, or clearly wrong but the person might have the right thing nearby (e.g., took a photo of the wrong thing).
- reason: one sentence explaining your verdict.
- Never comment on people's appearance, race, gender, age, or body.
- If the photo contains faces, ignore them — focus only on the rubric criteria.`;

const STRAVA_SYSTEM_PROMPT = `You are extracting structured data from a Strava fitness app screenshot.
Extract: activityType, distance, duration, date.
Return ONLY JSON matching the schema. If a field is not visible, omit it or return empty string.`;

function validateStravaExtracted(
  extracted: z.infer<typeof StravaExtractSchema>,
  challenge: Challenge,
): { pass: boolean; reason: string } {
  const reasons: string[] = [];
  if (extracted.date) {
    try {
      const d = new Date(extracted.date);
      const today = new Date();
      const diffMs = Math.abs(today.getTime() - d.getTime());
      const diffDays = diffMs / (1000 * 60 * 60 * 24);
      if (diffDays > 2) {
        reasons.push('Activity date is older than 2 days');
      }
    } catch { /* ignore */ }
  }
  if (challenge.category === 'movement' && extracted.duration) {
    reasons.push('Movement duration extracted');
  }
  const hasAny = extracted.activityType || extracted.distance || extracted.duration || extracted.date;
  return {
    pass: hasAny && reasons.length === 0 ? true : reasons.length === 0,
    reason: reasons.length ? reasons.join('; ') : 'Strava fields extracted.',
  };
}

export async function runVerifyProof(
  input: VerifyInput,
  provider: ModelProvider,
  challenge: Challenge,
  deps: {
    saveChallenge: (c: Challenge) => Promise<void>;
    logEvent: (e: AppEvent) => Promise<void>;
  },
): Promise<VerifyOutput> {
  return Sentry.startSpan({ name: 'verify-proof-workflow', op: 'workflow' }, async (span) => {
    span?.setAttribute('proofType', input.proofType);

    const previousAttempts = challenge.verification?.attempts || 0;
    const attempts = previousAttempts + 1;
    const maxAttempts = 2;

    if (input.proofType === 'photo' && !input.imageBase64) {
      return {
        pass: false,
        confidence: 0,
        reason: 'Photo proof requires image data.',
        needsRetake: true,
        honorSystem: false,
        attempts,
        challengeId: input.challengeId,
        status: 'failed',
      };
    }
    if (input.proofType === 'strava_screenshot' && !input.imageBase64) {
      return {
        pass: false, confidence: 0,
        reason: 'Strava screenshot proof requires image data.',
        needsRetake: true,
        honorSystem: false, attempts,
        challengeId: input.challengeId,
        status: 'failed',
      };
    }

    let pass: boolean;
    let confidence: number;
    let reason: string;
    let needsRetake: boolean;
    let honorSystem = false;
    let extractedData: VerifyOutput['extractedData'] = undefined;

    if (input.proofType === 'honor' && !input.honorConfirm) {
      return {
        pass: false, confidence: 0,
        reason: 'Honor system requires confirmation.',
        needsRetake: true,
        honorSystem: true, attempts,
        challengeId: input.challengeId,
        status: 'failed',
      };
    }

    switch (input.proofType) {
      case 'photo': {
        try {
          const res = await provider.analyzeImage({
            systemPrompt: VERIFY_SYSTEM_PROMPT,
            userPrompt: `Rubric: ${challenge.proofRubric}\n\nPlease verify the attached image against this rubric.`,
            imageBase64: input.imageBase64!,
            schema: VerificationSchema,
            maxTokens: 200,
          });
          const parsed = res.parsed ? VerificationSchema.parse(res.parsed) : null;
          if (parsed) {
            pass = parsed.pass;
            confidence = parsed.confidence;
            reason = parsed.reason;
            needsRetake = parsed.needs_retake && attempts < maxAttempts;
          } else {
            pass = false;
            confidence = 0;
            reason = 'Verifier returned an invalid response.';
            needsRetake = attempts < maxAttempts;
          }
        } catch (e: any) {
          pass = false;
          confidence = 0;
          reason = 'Verification service unavailable: ' + (e?.message || 'error');
          needsRetake = attempts < maxAttempts;
        }
        if (!pass && attempts >= maxAttempts) {
          honorSystem = true;
          pass = true;
          confidence = 0.5;
          reason = 'Max verification attempts reached; accepted via honor system. ' + reason;
          needsRetake = false;
        }
        break;
      }

      case 'strava_screenshot': {
        try {
          const res = await provider.analyzeImage({
            systemPrompt: STRAVA_SYSTEM_PROMPT,
            userPrompt: 'Extract activity fields from this Strava screenshot.',
            imageBase64: input.imageBase64!,
            schema: StravaExtractSchema,
            maxTokens: 150,
          });
          const parsed = res.parsed ? StravaExtractSchema.parse(res.parsed) : null;
          if (parsed) {
            extractedData = {
              activityType: parsed.activityType,
              distance: parsed.distance,
              duration: parsed.duration,
              date: parsed.date,
            };
            const codeCheck = validateStravaExtracted(parsed, challenge);
            const override = input.extractedData;
            if (override) {
              Object.assign(extractedData, override);
              pass = true;
              confidence = 0.9;
              reason = 'User-confirmed Strava fields.';
              needsRetake = false;
            } else {
              pass = codeCheck.pass;
              confidence = codeCheck.pass ? 0.75 : 0.3;
              reason = codeCheck.reason;
              needsRetake = attempts < maxAttempts && !codeCheck.pass;
            }
          } else {
            pass = false;
            confidence = 0;
            reason = 'Could not read the screenshot.';
            needsRetake = attempts < maxAttempts;
          }
        } catch (e: any) {
          pass = false;
          confidence = 0;
          reason = 'Strava extraction failed: ' + (e?.message || 'error');
          needsRetake = attempts < maxAttempts;
        }
        if (!pass && attempts >= maxAttempts) {
          honorSystem = true;
          pass = true;
          confidence = 0.5;
          reason = 'Max attempts reached; accepted via honor system. ' + reason;
          needsRetake = false;
        }
        break;
      }

      case 'voice_note': {
        honorSystem = true;
        pass = true;
        confidence = 1.0;
        reason = 'Voice note received; treated as honor-system completion with optional reflection.';
        needsRetake = false;
        break;
      }

      case 'honor':
      default: {
        honorSystem = true;
        pass = true;
        confidence = 1.0;
        reason = 'User confirmed completion via honor system.';
        needsRetake = false;
        break;
      }
    }

    const status: 'completed' | 'failed' = pass ? 'completed' : 'failed';

    challenge.status = status;
    challenge.verification = {
      pass,
      confidence,
      reason,
      attempts,
      honorSystem,
      extractedData: extractedData ? { ...extractedData } : undefined,
    };
    challenge.completedAt = status === 'completed' ? new Date() : challenge.completedAt;
    if (typeof input.screenSeconds === 'number') {
      challenge.screenSeconds = (challenge.screenSeconds || 0) + input.screenSeconds;
    }
    await deps.saveChallenge(challenge);

    await deps.logEvent({
      ts: new Date(),
      userId: input.userId,
      challengeId: input.challengeId,
      eventType: status === 'completed' ? 'completed' : 'failed',
      category: challenge.category,
      difficulty: challenge.difficulty,
      socialLevel: challenge.socialLevel,
      hour: new Date().getHours(),
      screenSeconds: challenge.screenSeconds,
    });

    span?.setAttribute('pass', pass);
    span?.setAttribute('confidence', confidence);
    span?.setAttribute('attempts', attempts);
    span?.setAttribute('honorSystem', honorSystem);

    return {
      pass,
      confidence,
      reason,
      needsRetake,
      honorSystem,
      extractedData,
      attempts,
      challengeId: input.challengeId,
      status,
    };
  });
}

export async function verifyProof(
  provider: ModelProvider,
  challenge: Challenge,
  imageBase64: string
) {
  const res = await provider.analyzeImage({
    systemPrompt: VERIFY_SYSTEM_PROMPT,
    userPrompt: `Rubric: ${challenge.proofRubric}\n\nPlease verify the attached image against this rubric.`,
    imageBase64,
    schema: VerificationSchema,
  });
  if (!res.parsed) {
    throw new Error('Failed to parse verification response from model');
  }
  return VerificationSchema.parse(res.parsed);
}
