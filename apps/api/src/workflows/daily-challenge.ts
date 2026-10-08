import { MockUserRepository, MockChallengeRepository, MockEventRepository } from '../db/mock';
import { MockProvider } from '../providers/mock';
import { HostedProvider } from '../providers/hosted';
import { sampleSeedTuples } from '../taxonomy/sampler';
import { validateChallengeSafety } from '../safety/validator';
import { ulid } from 'ulid';
import { z } from 'zod';

const ChallengeSchema = z.object({
  title: z.string().min(5).max(100),
  description: z.string().min(20).max(500),
  category: z.enum([
    'nature', 'movement', 'sport', 'social-light', 'social-bold',
    'creative', 'mindful', 'sensory', 'style', 'community', 'exploration'
  ]),
  difficulty: z.number().int().min(1).max(5),
  socialLevel: z.number().int().min(0).max(3),
  estimatedMinutes: z.number().int().min(2).max(120),
  proofType: z.enum(['photo', 'strava_screenshot', 'voice_note', 'honor']),
  proofRubric: z.string().min(10).max(300),
  safetyNotes: z.string().nullable(),
  locationHint: z.string().nullable(),
  tags: z.array(z.string()).min(2).max(6),
});

export async function runDailyChallenge(userId: string) {
  const userRepo = new MockUserRepository();
  const challengeRepo = new MockChallengeRepository();
  const eventRepo = new MockEventRepository();
  
  const providerMode = process.env.PROVIDER_MODE || 'mock';
  const provider = providerMode === 'hosted' ? new HostedProvider() : new MockProvider();

  // Step 1: Load Profile + Memory
  const profile = await userRepo.getProfile(userId);
  const recentChallenges = await challengeRepo.getRecent(userId, 30);
  
  // Step 2 & 3: Sample Seeds
  const candidates = sampleSeedTuples(profile, recentChallenges, 5);
  
  // Step 4: Score (Mock uses random for now)
  const selectedSeed = candidates[0]; // just picking the first one

  // Step 5: Generate
  const prompt = `You are the Touch Grass challenge writer. Your job is to create ONE unique, specific, 
actionable outdoor challenge based on the provided seed tuple and context.

RULES:
- The challenge must get the person OFF their phone and INTO the real world.
- Be specific and vivid, not generic. "Go to a park" is bad. "Find a tree with peeling 
  bark in a park near you, touch it, and photograph the texture" is good.
- The challenge must be completable in the estimated time.
- The challenge must be verifiable with the specified proof type.
- Include a safety note if the activity has any physical component.
- Social challenges must be consent-first, kind, and easy to decline.
- Never suggest anything dangerous, illegal, or requiring money.
- Match the specified difficulty level (1=easy couch-to-door, 5=adventurous).
- Write the proof_rubric as instructions for a photo verifier: what should be visible?

Respond ONLY with valid JSON matching the provided schema.`;

  const userContext = `Seed: ${JSON.stringify(selectedSeed)}\nUser Location: ${profile.city}`;

  const genResponse = await provider.generateText({
    systemPrompt: prompt,
    userPrompt: userContext,
    schema: ChallengeSchema
  });
  
  if (!genResponse.parsed) {
    throw new Error('Failed to generate a valid challenge schema');
  }
  const draftChallenge = genResponse.parsed as any;
  
  const challenge = {
    ...draftChallenge,
    id: ulid(),
    userId,
    seed: selectedSeed,
    sourceModel: "mock",
    status: "issued",
    createdAt: new Date(),
    issuedAt: new Date(),
    expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000)
  };

  // Step 7: Safety
  const safety = validateChallengeSafety(challenge, {});
  if (!safety.safe) {
    throw new Error(`Safety check failed: ${safety.violations.join(', ')}`);
  }

  // Step 8: Store + Log
  await challengeRepo.save(challenge);
  await eventRepo.log({
    ts: new Date(),
    userId,
    challengeId: challenge.id,
    eventType: 'issued'
  });

  return {
    challenge,
    metadata: {
      seedSelected: selectedSeed,
      safetyChecks: 1,
      sourceModel: "mock"
    }
  };
}
