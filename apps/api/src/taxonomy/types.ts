export type Category = 
  | 'nature' | 'movement' | 'sport' | 'social-light' | 'social-bold'
  | 'creative' | 'mindful' | 'sensory' | 'style' | 'community' | 'exploration';

export type PlaceType = 
  | 'park' | 'court' | 'street' | 'market' | 'rooftop'
  | 'trail' | 'water-edge' | 'neighborhood' | 'campus' | 'any';

export type Constraint = 
  | 'no-phone' | 'with-a-friend' | 'barefoot-if-safe' | 'collect-items'
  | 'timed' | 'silent' | 'golden-hour' | 'eyes-closed' | 'one-handed'
  | 'backwards' | 'none';

export type ProofType = 'photo' | 'strava_screenshot' | 'voice_note' | 'honor';

export interface SeedTuple {
  category: Category;
  placeType: PlaceType;
  constraint: Constraint;
  difficulty: number;        // 1-5
  socialLevel: number;       // 0-3
  proofType: ProofType;
  estimatedMinutes: number;  // derived from difficulty
}
