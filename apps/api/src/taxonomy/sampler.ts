import { Category, PlaceType, Constraint, SeedTuple } from './types.js';
import { UserProfile, Challenge } from '../db/interface.js';

const CATEGORIES: Category[] = ['nature', 'movement', 'sport', 'social-light', 'social-bold', 'creative', 'mindful', 'sensory', 'style', 'community', 'exploration'];
const PLACE_TYPES: PlaceType[] = ['park', 'court', 'street', 'market', 'rooftop', 'trail', 'water-edge', 'neighborhood', 'campus', 'any'];
const CONSTRAINTS: Constraint[] = ['no-phone', 'with-a-friend', 'barefoot-if-safe', 'collect-items', 'timed', 'silent', 'golden-hour', 'eyes-closed', 'one-handed', 'backwards', 'none'];

function randomElement<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

export function sampleSeedTuples(
  profile: UserProfile,
  recentChallenges: Challenge[],
  count: number = 20
): SeedTuple[] {
  const candidates: SeedTuple[] = [];
  let attempts = 0;

  const recentSeeds = new Set(recentChallenges.map(c => 
    `${c.seed.category}-${c.seed.placeType}-${c.seed.constraint}`
  ));

  while (candidates.length < count && attempts < count * 10) {
    attempts++;
    
    const category = randomElement(CATEGORIES);
    if (profile.optOutCategories.includes(category)) continue;

    const placeType = randomElement(PLACE_TYPES);
    const constraint = randomElement(CONSTRAINTS);
    const seedKey = `${category}-${placeType}-${constraint}`;
    
    // Dedup against recent challenges
    if (recentSeeds.has(seedKey)) continue;

    const difficulty = Math.floor(Math.random() * 5) + 1; // 1-5
    
    // Determine social level based on category
    let socialLevel = 0;
    if (category === 'social-bold') socialLevel = 3;
    else if (category === 'social-light') socialLevel = Math.floor(Math.random() * 2) + 1; // 1-2
    else if (category === 'community') socialLevel = Math.floor(Math.random() * 3); // 0-2
    
    // Respect user comfort
    if (socialLevel > profile.socialComfort) continue;

    const proofType = category === 'social-bold' ? 'honor' : 'photo';

    candidates.push({
      category,
      placeType,
      constraint,
      difficulty,
      socialLevel,
      proofType,
      estimatedMinutes: difficulty * 10
    });
  }

  // Fallback if we couldn't generate enough valid seeds
  if (candidates.length === 0) {
    candidates.push({
      category: 'nature',
      placeType: 'any',
      constraint: 'none',
      difficulty: 1,
      socialLevel: 0,
      proofType: 'honor',
      estimatedMinutes: 5
    });
  }

  return candidates;
}
