import { ModelProvider } from '../providers/interface';
import { Challenge } from '../db/interface';
import { z } from 'zod';

const VerificationSchema = z.object({
  pass: z.boolean(),
  confidence: z.number().min(0).max(1),
  reason: z.string().min(5).max(200),
  needs_retake: z.boolean(),
});

export async function verifyProof(
  provider: ModelProvider,
  challenge: Challenge,
  imageBase64: string
) {
  if (challenge.proofType !== 'photo' && challenge.proofType !== 'strava_screenshot') {
    return {
      pass: true,
      confidence: 1.0,
      reason: 'Honor system bypass or unsupported proof type',
      needs_retake: false
    };
  }

  const systemPrompt = `You are a proof verifier for the Touch Grass outdoor challenge app. You are given a photo and a rubric describing what the photo should show to prove challenge completion.

RULES:
- Judge ONLY based on the rubric. Does the photo show what the rubric requires?
- Be generous but honest. The person went outside and tried — give credit where due.
- confidence: 0.0-1.0. Use 0.8+ for clear matches, 0.4-0.6 for ambiguous, <0.4 for mismatches.
- needs_retake: true ONLY if the photo is blurry, dark, or clearly wrong but the person might have the right thing nearby (e.g., took a photo of the wrong thing).
- reason: one sentence explaining your verdict.
- Never comment on people's appearance, race, gender, age, or body.
- If the photo contains faces, ignore them — focus only on the rubric criteria.`;

  const userPrompt = `Rubric: ${challenge.proofRubric}\n\nPlease verify the attached image against this rubric.`;

  const res = await provider.analyzeImage({
    systemPrompt,
    userPrompt,
    imageBase64,
    schema: VerificationSchema
  });

  if (!res.parsed) {
    throw new Error('Failed to parse verification response from model');
  }

  return res.parsed as z.infer<typeof VerificationSchema>;
}
