import { MockUserRepository, MockChallengeRepository, MockEventRepository } from '../db/mock';
import { MockProvider } from '../providers/mock';
import { sampleSeedTuples } from '../taxonomy/sampler';
import { validateChallengeSafety } from '../safety/validator';
import { ulid } from 'ulid';

export async function runDailyChallenge(userId: string) {
  const userRepo = new MockUserRepository();
  const challengeRepo = new MockChallengeRepository();
  const eventRepo = new MockEventRepository();
  const provider = new MockProvider();

  // Step 1: Load Profile + Memory
  const profile = await userRepo.getProfile(userId);
  const recentChallenges = await challengeRepo.getRecent(userId, 30);
  
  // Step 2 & 3: Sample Seeds
  const candidates = sampleSeedTuples(profile, recentChallenges, 5);
  
  // Step 4: Score (Mock uses random for now)
  const selectedSeed = candidates[0]; // just picking the first one

  // Step 5: Generate
  const prompt = `You are the Touch Grass challenge writer. Seed: ${JSON.stringify(selectedSeed)}`;
  const genResponse = await provider.generateText({
    systemPrompt: prompt,
    userPrompt: "Generate a challenge",
  });
  
  const draftChallenge = JSON.parse(genResponse.text);
  
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
