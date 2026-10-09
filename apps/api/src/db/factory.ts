import {
  ChallengeRepository,
  EventRepository,
  UserRepository,
} from './interface.js';
import {
  MockChallengeRepository,
  MockEventRepository,
  MockUserRepository,
} from './mock.js';

type StoreMode = 'hosted' | 'mongo-only' | 'local' | 'mock';

const singleton = {
  challenges: null as ChallengeRepository | null,
  events: null as EventRepository | null,
  users: null as UserRepository | null,
};

function getStoreMode(): StoreMode {
  return (process.env.STORE_MODE || 'mock') as StoreMode;
}

export function getChallengeRepository(): ChallengeRepository {
  if (!singleton.challenges) {
    const mode = getStoreMode();
    switch (mode) {
      case 'mock':
      case 'local':
      case 'hosted':
      case 'mongo-only':
      default:
        singleton.challenges = new MockChallengeRepository();
    }
  }
  return singleton.challenges;
}

export function getEventRepository(): EventRepository {
  if (!singleton.events) {
    const mode = getStoreMode();
    switch (mode) {
      case 'mock':
      case 'local':
      case 'hosted':
      case 'mongo-only':
      default:
        singleton.events = new MockEventRepository();
    }
  }
  return singleton.events;
}

export function getUserRepository(): UserRepository {
  if (!singleton.users) {
    const mode = getStoreMode();
    switch (mode) {
      case 'mock':
      case 'local':
      case 'hosted':
      case 'mongo-only':
      default:
        singleton.users = new MockUserRepository();
    }
  }
  return singleton.users;
}

export function getRepositories() {
  return {
    challenges: getChallengeRepository(),
    events: getEventRepository(),
    users: getUserRepository(),
  };
}
