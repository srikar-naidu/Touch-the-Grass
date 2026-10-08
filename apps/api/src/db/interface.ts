export interface UserProfile {
  userId: string;
  city: string;
  socialComfort: number; // 0-3
  optOutCategories: string[];
  timezone: string;
  providerMode: 'hosted' | 'local' | 'mock';
  createdAt: Date;
  updatedAt: Date;
}

export interface SeedTuple {
  category: string;
  placeType: string;
  constraint: string;
  difficulty: number;
  socialLevel: number;
  proofType: string;
  estimatedMinutes?: number;
}

export interface Challenge {
  id: string;
  userId: string;
  title: string;
  description: string;
  category: string;
  difficulty: number;
  socialLevel: number;
  estimatedMinutes: number;
  proofType: string;
  proofRubric: string;
  safetyNotes: string | null;
  locationHint: string | null;
  tags: string[];
  seed: SeedTuple;
  sourceModel: string;
  embedding?: number[];
  status: 'issued' | 'completed' | 'failed' | 'skipped' | 'expired';
  verification?: {
    pass: boolean;
    confidence: number;
    reason: string;
    attempts: number;
    honorSystem: boolean;
    extractedData?: Record<string, any>;
  };
  reflection?: {
    summary: string | null;
    moodBefore: number | null;
    moodAfter: number | null;
    tags: string[];
  };
  screenSeconds?: number;
  audioUrl?: string | null;
  synthetic?: boolean;
  createdAt: Date;
  issuedAt: Date;
  completedAt?: Date;
  expiresAt: Date;
}

export interface AppEvent {
  ts: Date;
  userId: string;
  challengeId?: string;
  eventType: 'issued' | 'completed' | 'failed' | 'skipped' | 'reflection' | 'screen_time';
  category?: string;
  difficulty?: number;
  socialLevel?: number;
  weather?: string;
  hour?: number;
  minutesTaken?: number;
  moodBefore?: number;
  moodAfter?: number;
  screenSeconds?: number;
  synthetic?: boolean;
}

export interface Aggregates {
  weeklyCompletion: Record<string, any>;
  categoryCompletion: Record<string, any>;
  hourlyCompletion: Record<string, any>;
}

export interface ChallengeRepository {
  save(challenge: Challenge): Promise<void>;
  getToday(userId: string): Promise<Challenge | null>;
  getRecent(userId: string, days: number): Promise<Challenge[]>;
  findSimilar(embedding: number[], threshold: number, userId: string): Promise<Challenge[]>;
}

export interface EventRepository {
  log(event: AppEvent): Promise<void>;
  getUserHistory(userId: string, limit: number): Promise<AppEvent[]>;
  getAggregates(userId: string, period: string): Promise<Aggregates>;
}

export interface UserRepository {
  getProfile(userId: string): Promise<UserProfile>;
  updateProfile(userId: string, updates: Partial<UserProfile>): Promise<void>;
  deleteAll(userId: string): Promise<void>;
}
