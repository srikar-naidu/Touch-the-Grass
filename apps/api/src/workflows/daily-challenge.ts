import { MockUserRepository, MockChallengeRepository, MockEventRepository } from '../db/mock.js';
import { MockProvider } from '../providers/mock.js';
import { HostedProvider } from '../providers/hosted.js';
import { sampleSeedTuples } from '../taxonomy/sampler.js';
import { validateChallengeSafety } from '../safety/validator.js';
import { ulid } from 'ulid';
import { z } from 'zod';
import { Challenge } from '../db/interface.js';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

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

type DraftChallenge = z.infer<typeof ChallengeSchema>;

export interface DedupResult {
  isDuplicate: boolean;
  similarChallenge?: Challenge;
  reason?: 'seed' | 'tags' | 'embedding';
}

function sameSeed(a: Challenge, b: Challenge): boolean {
  return a.seed.category === b.seed.category &&
    a.seed.placeType === b.seed.placeType &&
    a.seed.constraint === b.seed.constraint;
}

function tagOverlap(a: Challenge, b: Challenge): number {
  const left = new Set(a.tags.map(tag => tag.toLowerCase()));
  const right = new Set(b.tags.map(tag => tag.toLowerCase()));
  const shared = [...left].filter(tag => right.has(tag)).length;
  return shared / Math.max(1, Math.min(left.size, right.size));
}

export async function checkChallengeDuplicate(
  challenge: Challenge,
  recentChallenges: Challenge[],
  challengeRepo: { findSimilar(embedding: number[], threshold: number, userId: string): Promise<Challenge[]> },
  embedding?: number[]
): Promise<DedupResult> {
  const seedMatch = recentChallenges.find(existing => sameSeed(challenge, existing));
  if (seedMatch) return { isDuplicate: true, similarChallenge: seedMatch, reason: 'seed' };

  const tagMatch = recentChallenges.find(existing => tagOverlap(challenge, existing) > 0.7);
  if (tagMatch) return { isDuplicate: true, similarChallenge: tagMatch, reason: 'tags' };

  if (embedding?.length) {
    const similar = await challengeRepo.findSimilar(embedding, 0.85, challenge.userId);
    if (similar[0]) return { isDuplicate: true, similarChallenge: similar[0], reason: 'embedding' };
  }

  return { isDuplicate: false };
}

function loadBackupChallenge(): DraftChallenge {
  const fixturePath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../fixtures/responses/challenge-writer.json');
  try {
    return ChallengeSchema.parse(JSON.parse(fs.readFileSync(fixturePath, 'utf8')));
  } catch {
    return {
      title: 'Notice Three Signs of the Season',
      description: 'Walk outside for ten minutes and notice three small signs of the current season. Write them down or photograph one texture that catches your attention.',
      category: 'nature',
      difficulty: 1,
      socialLevel: 0,
      estimatedMinutes: 10,
      proofType: 'photo',
      proofRubric: 'The photo should show an outdoor natural detail or texture noticed during the walk.',
      safetyNotes: 'Stay on a safe, familiar route and watch for uneven ground.',
      locationHint: null,
      tags: ['nature', 'observation', 'walk']
    };
  }
}

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

  let draftChallenge: DraftChallenge;
  let sourceModel = providerMode === 'hosted'
    ? (process.env.GEMMA_TEXT_MODEL || 'gemma-text')
    : 'mock';

  try {
    const genResponse = await provider.generateText({
      systemPrompt: prompt,
      userPrompt: userContext,
      schema: ChallengeSchema,
      maxTokens: 500,
      temperature: 0.8
    });

    if (!genResponse.parsed) throw new Error('Model returned an invalid challenge schema');
    draftChallenge = ChallengeSchema.parse(genResponse.parsed);
  } catch (error) {
    // Step 5's final safety net: always return a usable, schema-valid challenge
    // when the model endpoint is unavailable or exhausts its validation retries.
    console.warn('Challenge generation failed; using backup challenge', error);
    draftChallenge = loadBackupChallenge();
    sourceModel = 'backup-pool';
  }
  
  const challenge: Challenge = {
    ...draftChallenge,
    id: ulid(),
    userId,
    seed: selectedSeed,
    sourceModel,
    status: 'issued',
    createdAt: new Date(),
    issuedAt: new Date(),
    expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000)
  };

  // Step 6: Dedup Check
  let embedding: number[] | undefined;
  try {
    const embeddingText = `${challenge.title}\n${challenge.description}\n${challenge.tags.join(', ')}`;
    embedding = (await provider.embed([embeddingText]))[0];
  } catch (error) {
    console.warn('Embedding unavailable; continuing without vector deduplication', error);
  }
  const dedup = await checkChallengeDuplicate(challenge, recentChallenges, challengeRepo, embedding);
  if (dedup.isDuplicate) {
    throw new Error(`Duplicate challenge detected by ${dedup.reason}`);
  }
  challenge.embedding = embedding;

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
      dedupAttempts: 1,
      isDuplicate: false,
      sourceModel
    }
  };
}
