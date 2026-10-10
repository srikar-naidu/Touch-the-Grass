import { 
  ChallengeRepository, 
  EventRepository, 
  UserRepository,
  Challenge,
  AppEvent,
  UserProfile,
  Aggregates
} from './interface.js';

export class MockChallengeRepository implements ChallengeRepository {
  private challenges: Challenge[] = [];

  async save(challenge: Challenge): Promise<void> {
    const idx = this.challenges.findIndex(c => c.id === challenge.id);
    if (idx >= 0) {
      this.challenges[idx] = challenge;
    } else {
      this.challenges.push(challenge);
    }
  }

  async getToday(userId: string): Promise<Challenge | null> {
    const today = new Date();
    return this.challenges.find(c => 
      c.userId === userId && 
      c.createdAt.toDateString() === today.toDateString()
    ) || null;
  }

  async getRecent(userId: string, _days: number): Promise<Challenge[]> {
    return this.challenges.filter(c => c.userId === userId);
  }

  async findSimilar(_embedding: number[], _threshold: number, _userId: string): Promise<Challenge[]> {
    return []; // Mock: no duplicates found
  }
}

export class MockEventRepository implements EventRepository {
  private events: AppEvent[] = [];

  async log(event: AppEvent): Promise<void> {
    this.events.push(event);
  }

  async getUserHistory(userId: string, limit: number): Promise<AppEvent[]> {
    return this.events.filter(e => e.userId === userId).slice(0, limit);
  }

  async getAggregates(_userId: string, _period: string): Promise<Aggregates> {
    return {
      weeklyCompletion: {},
      categoryCompletion: {},
      hourlyCompletion: {}
    };
  }
}

export class MockUserRepository implements UserRepository {
  private profiles: Map<string, UserProfile> = new Map();

  async getProfile(userId: string): Promise<UserProfile> {
    if (!this.profiles.has(userId)) {
      this.profiles.set(userId, {
        userId,
        city: 'Hyderabad, India',
        socialComfort: 1,
        optOutCategories: [],
        timezone: 'Asia/Kolkata',
        providerMode: 'mock',
        createdAt: new Date(),
        updatedAt: new Date()
      });
    }
    return this.profiles.get(userId)!;
  }

  async updateProfile(userId: string, updates: Partial<UserProfile>): Promise<void> {
    const profile = await this.getProfile(userId);
    this.profiles.set(userId, { ...profile, ...updates, updatedAt: new Date() });
  }

  async deleteAll(userId: string): Promise<void> {
    this.profiles.delete(userId);
  }
}
