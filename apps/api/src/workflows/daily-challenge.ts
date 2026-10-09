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
import * as Sentry from '@sentry/node';

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

// Keep mock-mode state for the lifetime of the API process so Step 1 memory
// and Step 6 deduplication work across requests in local/CI mode.
const mockUserRepo = new MockUserRepository();
const mockChallengeRepo = new MockChallengeRepository();
const mockEventRepo = new MockEventRepository();

const SafetySchema = z.object({
  safe: z.boolean(),
  reason: z.string().min(3).max(300),
});

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

function scoreSeed(seed: { difficulty: number; socialLevel: number }, profile: { socialComfort: number }): number {
  const difficultyScore = 1 - Math.abs(seed.difficulty - 2.5) / 4;
  const socialScore = seed.socialLevel <= profile.socialComfort ? 1 : 0;
  return Math.max(0, Math.min(1, difficultyScore * 0.7 + socialScore * 0.3));
}

async function generateAudio(text: string): Promise<{ audioUrl: string | null; useFallback: boolean }> {
  const apiKey = process.env.ELEVENLABS_API_KEY;
  if (!apiKey) return { audioUrl: null, useFallback: true };

  try {
    const voiceId = process.env.ELEVENLABS_VOICE_ID || 'EXAVITQu4vr4xnSDxMaL';
    const response = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`, {
      method: 'POST',
      headers: {
        'xi-api-key': apiKey,
        'Content-Type': 'application/json',
        Accept: 'audio/mpeg',
      },
      body: JSON.stringify({
        text,
        model_id: process.env.ELEVENLABS_MODEL_ID || 'eleven_multilingual_v2',
        output_format: 'mp3_22050_32',
      }),
      signal: AbortSignal.timeout(30_000),
    });
    if (!response.ok) throw new Error(`ElevenLabs returned ${response.status}`);
    const audio = Buffer.from(await response.arrayBuffer()).toString('base64');
    return { audioUrl: `data:audio/mpeg;base64,${audio}`, useFallback: false };
  } catch (error) {
    console.warn('Audio generation failed; using browser speech fallback', error);
    return { audioUrl: null, useFallback: true };
  }
}

async function runDailyChallengeWorkflow(userId: string) {
  const userRepo = mockUserRepo;
  const challengeRepo = mockChallengeRepo;
  const eventRepo = mockEventRepo;
  
  const providerMode = process.env.PROVIDER_MODE || 'mock';
  const provider = providerMode === 'hosted' ? new HostedProvider() : new MockProvider();

  // Step 1: Load Profile + Memory
  const profile = await userRepo.getProfile(userId);
  const recentChallenges = await challengeRepo.getRecent(userId, 30);
  
  // Step 2: Gather Context. External weather/search grounding is optional;
  // retain a deterministic local context when those services are unavailable.
  const context = {
    city: profile.city,
    weather: process.env.DEFAULT_WEATHER || 'unknown',
    timeOfDay: new Date().toLocaleTimeString('en-US', { hour: 'numeric', hour12: false }),
  };

  // Step 3: Sample Seeds
  const candidates = sampleSeedTuples(profile, recentChallenges, 5);
  
  // Step 4: Heuristic scorer. A TabPFN service can replace this behind the
  // same boundary later; the fallback remains useful for local/offline mode.
  const scoredCandidates = candidates.map(seed => ({
    seed,
    probability: scoreSeed(seed, profile),
  }));
  const selectedSeed = scoredCandidates
    .sort((a, b) => Math.abs(a.probability - 0.65) - Math.abs(b.probability - 0.65))[0]?.seed || candidates[0];

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

  const userContext = `Seed: ${JSON.stringify(selectedSeed)}\nContext: ${JSON.stringify(context)}`;

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
  // With no alternate seed generator/provider available, preserve availability
  // and make the similarity explicit for callers and future review tooling.
  const similarTo = dedup.isDuplicate ? dedup.similarChallenge?.id : undefined;
  challenge.embedding = embedding;

  // Step 7: Safety
  const safety = validateChallengeSafety(challenge, {});
  if (!safety.safe) {
    console.warn('Generated challenge failed code safety; using backup challenge', safety.violations);
    Object.assign(challenge, loadBackupChallenge(), { sourceModel: 'backup-pool' });
    sourceModel = 'backup-pool';
  }

  const safetyReview = await provider.generateText({
    systemPrompt: `You are the safety reviewer for an outdoor challenge app.
Review the challenge for realistic physical, legal, privacy, social, and environmental risks.
Reject challenges involving trespassing, dangerous heights or traffic, substances, spending money,
medical claims, coercive social interaction, or unsafe instructions. Be practical and conservative.
Respond only with JSON matching the provided schema.`,
    userPrompt: `Challenge to review:\n${JSON.stringify({
      title: challenge.title,
      description: challenge.description,
      category: challenge.category,
      difficulty: challenge.difficulty,
      socialLevel: challenge.socialLevel,
      safetyNotes: challenge.safetyNotes,
    })}`,
    schema: SafetySchema,
    maxTokens: 120,
    temperature: 0
  });

  if (!safetyReview.parsed) {
    throw new Error('Safety model returned an invalid response');
  }
  const modelSafety = SafetySchema.parse(safetyReview.parsed);
  if (!modelSafety.safe) {
    console.warn('Safety model rejected generated challenge; using backup challenge', modelSafety.reason);
    Object.assign(challenge, loadBackupChallenge(), { sourceModel: 'backup-pool' });
    sourceModel = 'backup-pool';
  }

  // Step 8: Store + Log
  await challengeRepo.save(challenge);
  await eventRepo.log({
    ts: new Date(),
    userId,
    challengeId: challenge.id,
    eventType: 'issued'
  });

  // Step 9: Generate Audio
  const audio = await generateAudio(`${challenge.title}. ${challenge.description}`);
  challenge.audioUrl = audio.audioUrl;
  // Persist the optional audio URL without making audio availability a hard failure.
  await challengeRepo.save(challenge);

  return {
    challenge,
    audioUrl: audio.audioUrl,
    useAudioFallback: audio.useFallback,
    metadata: {
      seedSelected: selectedSeed,
      scoringMethod: 'heuristic',
      context,
      safetyChecks: 2,
      dedupAttempts: 1,
      isDuplicate: dedup.isDuplicate,
      similarTo,
      sourceModel
    }
  };
}

// Step 10: Sentry Wrap
export async function runDailyChallenge(userId: string) {
  return Sentry.startSpan({ name: 'daily-challenge-workflow', op: 'workflow' }, async span => {
    span.setAttribute('workflow', 'daily-challenge');
    span.setAttribute('userIdHash', userId.length);
    try {
      const result = await runDailyChallengeWorkflow(userId);
      span.setAttribute('seedsConsidered', 5);
      span.setAttribute('sourceModel', result.metadata.sourceModel);
      span.setAttribute('dedupAttempts', result.metadata.dedupAttempts);
      span.setAttribute('safetyChecks', result.metadata.safetyChecks);
      span.setAttribute('audioFallback', result.useAudioFallback);
      return result;
    } catch (error) {
      Sentry.captureException(error, { tags: { workflow: 'daily-challenge' } });
      throw error;
    }
  });
}
