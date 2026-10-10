import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import * as Sentry from '@sentry/node';
import { config } from 'dotenv';
import { z } from 'zod';

config();

import { getModelProvider } from './providers/factory.js';
import { getRepositories } from './db/factory.js';
import { runDailyChallenge } from './workflows/daily-challenge.js';
import { runVerifyProof, VerifyInput } from './workflows/verify.js';
import { runReflection } from './workflows/reflect.js';
import { runWeeklyReport } from './workflows/report.js';
import { Challenge, AppEvent } from './db/interface.js';

const app = new Hono();

app.use('*', cors());

if (process.env.SENTRY_DSN) {
  Sentry.init({
    dsn: process.env.SENTRY_DSN,
    environment: process.env.SENTRY_ENVIRONMENT || 'development',
    tracesSampleRate: 1.0,
  });
}

const provider = getModelProvider();
const repos = getRepositories();

const json = (c: any, data: unknown, status = 200) => {
  return c.json(data, status);
};

const err = (c: any, message: string, status = 400, detail?: unknown) => {
  return c.json({ error: message, ...(detail !== undefined ? { detail } : {}) }, status);
};

const requireBody = async (c: any, schema: z.ZodSchema) => {
  let body: any;
  try {
    body = await c.req.json();
  } catch {
    body = {};
  }
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return { ok: false as const, issues: parsed.error.issues, raw: body };
  }
  return { ok: true as const, value: parsed.data, raw: body };
};

const requireUserId = (c: any): string => {
  const userId = c.req.param('userId') || c.req.query('userId');
  if (!userId) return 'anonymous-user';
  return String(userId);
};

const DailyChallengeBody = z.object({
  userId: z.string().min(1).optional(),
  forceRegenerate: z.boolean().optional(),
});

app.get('/health', (c) => {
  return json(c, { status: 'ok', time: new Date().toISOString(), mode: process.env.PROVIDER_MODE || 'mock' });
});

app.post('/api/challenges/daily', async (c) => {
  const parsed = await requireBody(c, DailyChallengeBody);
  if (!parsed.ok) return err(c, 'Invalid request body', 400, parsed.issues);
  const userId = parsed.value.userId || 'anonymous-user';
  try {
    const result = await runDailyChallenge(userId);
    return json(c, result);
  } catch (e: any) {
    if (process.env.SENTRY_DSN) Sentry.captureException(e);
    return err(c, 'Challenge generation temporarily unavailable', 500, e?.message);
  }
});

app.get('/api/challenges/today', async (c) => {
  const userId = c.req.query('userId') || 'anonymous-user';
  try {
    let today = await repos.challenges.getToday(userId);
    if (!today) {
      const generated = await runDailyChallenge(userId);
      today = generated.challenge as Challenge;
    }
    return json(c, { challenge: today });
  } catch (e: any) {
    if (process.env.SENTRY_DSN) Sentry.captureException(e);
    return err(c, 'Unable to load today challenge', 500, e?.message);
  }
});

const RecentQuery = z.object({
  days: z.coerce.number().int().min(1).max(365).default(30),
  limit: z.coerce.number().int().min(1).max(500).default(50),
});

app.get('/api/challenges/recent', async (c) => {
  const userId = c.req.query('userId') || 'anonymous-user';
  const q = RecentQuery.safeParse({
    days: c.req.query('days'),
    limit: c.req.query('limit'),
  });
  const days = q.success ? q.data.days : 30;
  const limit = q.success ? q.data.limit : 50;
  try {
    const all = await repos.challenges.getRecent(userId, days);
    const sorted = [...all]
      .sort((a, b) => b.issuedAt.getTime() - a.issuedAt.getTime())
      .slice(0, limit);
    return json(c, { challenges: sorted, count: sorted.length });
  } catch (e: any) {
    return err(c, 'Unable to load recent challenges', 500, e?.message);
  }
});

app.get('/api/challenges/:id', async (c) => {
  const id = c.req.param('id');
  const userId = c.req.query('userId') || 'anonymous-user';
  try {
    const all = await repos.challenges.getRecent(userId, 90);
    const challenge = all.find(c => c.id === id) || null;
    if (!challenge) return err(c, 'Challenge not found', 404);
    return json(c, { challenge });
  } catch (e: any) {
    return err(c, 'Unable to load challenge', 500, e?.message);
  }
});

const VerifyBody = z.object({
  userId: z.string().min(1).optional(),
  proofType: z.enum(['photo', 'strava_screenshot', 'voice_note', 'honor']),
  imageBase64: z.string().optional(),
  voiceBase64: z.string().optional(),
  honorConfirm: z.boolean().optional(),
  extractedData: z.record(z.any()).optional(),
  screenSeconds: z.number().optional(),
});

app.post('/api/challenges/:id/verify', async (c) => {
  const id = c.req.param('id');
  const parsed = await requireBody(c, VerifyBody);
  if (!parsed.ok) return err(c, 'Invalid verification payload', 400, parsed.issues);
  const body = parsed.value;
  const userId = body.userId || 'anonymous-user';
  try {
    const all = await repos.challenges.getRecent(userId, 90);
    const challenge = all.find(ch => ch.id === id);
    if (!challenge) return err(c, 'Challenge not found', 404);
    if (challenge.status !== 'issued' && challenge.status !== 'failed') {
      return err(c, `Challenge already ${challenge.status}`, 400);
    }
    const input: VerifyInput = {
      challengeId: id,
      userId,
      proofType: body.proofType,
      imageBase64: body.imageBase64,
      voiceBase64: body.voiceBase64,
      honorConfirm: body.honorConfirm,
      extractedData: body.extractedData,
      screenSeconds: body.screenSeconds,
    };
    const result = await runVerifyProof(
      input,
      provider,
      challenge,
      {
        saveChallenge: (ch: Challenge) => repos.challenges.save(ch),
        logEvent: (e: AppEvent) => repos.events.log(e),
      },
    );
    return json(c, result);
  } catch (e: any) {
    if (process.env.SENTRY_DSN) Sentry.captureException(e);
    return err(c, 'Proof verification temporarily unavailable', 500, e?.message);
  }
});

const SkipBody = z.object({
  userId: z.string().min(1).optional(),
  reason: z.string().max(300).optional(),
  screenSeconds: z.number().optional(),
});

app.post('/api/challenges/:id/skip', async (c) => {
  const id = c.req.param('id');
  const parsed = await requireBody(c, SkipBody);
  if (!parsed.ok) return err(c, 'Invalid payload', 400, parsed.issues);
  const userId = parsed.value.userId || 'anonymous-user';
  try {
    const all = await repos.challenges.getRecent(userId, 90);
    const challenge = all.find(ch => ch.id === id);
    if (!challenge) return err(c, 'Challenge not found', 404);
    if (challenge.status !== 'issued') {
      return err(c, `Challenge already ${challenge.status}`, 400);
    }
    challenge.status = 'skipped';
    if (typeof parsed.value.screenSeconds === 'number') {
      challenge.screenSeconds = (challenge.screenSeconds || 0) + parsed.value.screenSeconds;
    }
    await repos.challenges.save(challenge);
    await repos.events.log({
      ts: new Date(),
      userId,
      challengeId: id,
      eventType: 'skipped',
      category: challenge.category,
      difficulty: challenge.difficulty,
      socialLevel: challenge.socialLevel,
    });
    return json(c, {
      skipped: true,
      challengeId: id,
      status: 'skipped',
      safeToSkip: true,
      reason: parsed.value.reason || null,
    });
  } catch (e: any) {
    return err(c, 'Unable to skip challenge', 500, e?.message);
  }
});

const ReflectBody = z.object({
  userId: z.string().min(1).optional(),
  voiceBase64: z.string().optional(),
  textInput: z.string().max(5000).optional(),
});

app.post('/api/challenges/:id/reflect', async (c) => {
  const id = c.req.param('id');
  const parsed = await requireBody(c, ReflectBody);
  if (!parsed.ok) return err(c, 'Invalid reflection payload', 400, parsed.issues);
  const userId = parsed.value.userId || 'anonymous-user';
  try {
    const all = await repos.challenges.getRecent(userId, 90);
    const challenge = all.find(ch => ch.id === id);
    if (!challenge) return err(c, 'Challenge not found', 404);
    const result = await runReflection(
      {
        challengeId: id,
        userId,
        voiceBase64: parsed.value.voiceBase64,
        textInput: parsed.value.textInput,
      },
      provider,
      challenge,
      {
        saveChallenge: (ch: Challenge) => repos.challenges.save(ch),
        logEvent: (e: AppEvent) => repos.events.log(e),
      },
    );
    return json(c, { reflection: result, challengeId: id });
  } catch (e: any) {
    if (process.env.SENTRY_DSN) Sentry.captureException(e);
    return err(c, 'Reflection processing failed', 500, e?.message);
  }
});

app.get('/api/users/:userId/profile', async (c) => {
  const userId = requireUserId(c);
  try {
    const profile = await repos.users.getProfile(userId);
    return json(c, { profile });
  } catch (e: any) {
    return err(c, 'Unable to load profile', 500, e?.message);
  }
});

const UpdateProfileBody = z.object({
  city: z.string().min(1).max(200).optional(),
  socialComfort: z.number().int().min(0).max(3).optional(),
  optOutCategories: z.array(z.string()).max(50).optional(),
  timezone: z.string().min(1).max(120).optional(),
});

app.put('/api/users/:userId/profile', async (c) => {
  const userId = requireUserId(c);
  const parsed = await requireBody(c, UpdateProfileBody);
  if (!parsed.ok) return err(c, 'Invalid profile update', 400, parsed.issues);
  try {
    await repos.users.getProfile(userId);
    await repos.users.updateProfile(userId, parsed.value);
    const updated = await repos.users.getProfile(userId);
    return json(c, { profile: updated, updated: Object.keys(parsed.value) });
  } catch (e: any) {
    return err(c, 'Unable to update profile', 500, e?.message);
  }
});

app.delete('/api/users/:userId/data', async (c) => {
  const userId = requireUserId(c);
  try {
    const challenges = await repos.challenges.getRecent(userId, 3650);
    const eventHistory = await repos.events.getUserHistory(userId, 100000);

    for (const ch of challenges) {
      ch.status = 'expired';
      await repos.challenges.save(ch);
    }
    await repos.users.deleteAll(userId);
    await repos.events.log({
      ts: new Date(),
      userId: 'system',
      eventType: 'screen_time',
      synthetic: false,
    });

    return json(c, {
      deleted: true,
      collections: ['challenges', 'events', 'users'],
      challengesDeleted: challenges.length,
      eventsDeleted: eventHistory.length,
      userId,
    });
  } catch (e: any) {
    return err(c, 'Deletion failed', 500, e?.message);
  }
});

const HistoryQuery = z.object({
  limit: z.coerce.number().int().min(1).max(1000).default(100),
  eventType: z.string().optional(),
});

app.get('/api/users/:userId/history', async (c) => {
  const userId = requireUserId(c);
  const q = HistoryQuery.safeParse({
    limit: c.req.query('limit'),
    eventType: c.req.query('eventType'),
  });
  const limit = q.success ? q.data.limit : 100;
  try {
    let history = await repos.events.getUserHistory(userId, limit);
    if (q.success && q.data.eventType) {
      history = history.filter(h => h.eventType === q.data.eventType);
    }
    history = [...history].sort((a, b) => b.ts.getTime() - a.ts.getTime()).slice(0, limit);
    return json(c, { events: history, count: history.length });
  } catch (e: any) {
    return err(c, 'Unable to load history', 500, e?.message);
  }
});

const WeeklyReportQuery = z.object({
  weekStart: z.string().optional(),
});

app.get('/api/users/:userId/report/weekly', async (c) => {
  const userId = requireUserId(c);
  const q = WeeklyReportQuery.safeParse({ weekStart: c.req.query('weekStart') });
  const now = new Date();
  const day = now.getDay() || 7;
  const monday = new Date(now);
  monday.setDate(now.getDate() - (day - 1));
  monday.setHours(0, 0, 0, 0);
  const weekStart = q.success && q.data.weekStart ? q.data.weekStart : monday.toISOString().slice(0, 10);
  try {
    const report = await runWeeklyReport(
      { userId, weekStart },
      provider,
      {
        getChallenges: (uid, days) => repos.challenges.getRecent(uid, days),
        getAggregates: (uid, period) => repos.events.getAggregates(uid, period),
        getHistory: (uid, limit) => repos.events.getUserHistory(uid, limit),
      },
    );
    return json(c, { report, weekStart });
  } catch (e: any) {
    if (process.env.SENTRY_DSN) Sentry.captureException(e);
    return err(c, 'Weekly report generation failed', 500, e?.message);
  }
});

const AggregatesQuery = z.object({
  period: z.enum(['7d', '30d', '90d', 'all']).default('30d'),
});

app.get('/api/users/:userId/aggregates', async (c) => {
  const userId = requireUserId(c);
  const q = AggregatesQuery.safeParse({ period: c.req.query('period') });
  const period = q.success ? q.data.period : '30d';
  try {
    const daysMap: Record<string, number> = { '7d': 7, '30d': 30, '90d': 90, all: 3650 };
    const challenges = await repos.challenges.getRecent(userId, daysMap[period] || 30);
    const agg = await repos.events.getAggregates(userId, period);

    const issued = challenges.length;
    const completed = challenges.filter(c => c.status === 'completed').length;
    const skipped = challenges.filter(c => c.status === 'skipped').length;
    const failed = challenges.filter(c => c.status === 'failed').length;
    const completionRate = issued ? completed / issued : 0;

    const byCategory: Record<string, { issued: number; completed: number; rate: number }> = {};
    for (const ch of challenges) {
      if (!byCategory[ch.category]) {
        byCategory[ch.category] = { issued: 0, completed: 0, rate: 0 };
      }
      byCategory[ch.category].issued++;
      if (ch.status === 'completed') byCategory[ch.category].completed++;
    }
    for (const key of Object.keys(byCategory)) {
      const row = byCategory[key];
      row.rate = row.issued ? row.completed / row.issued : 0;
    }

    const screenSecondsArr = challenges.map(c => c.screenSeconds).filter((s): s is number => typeof s === 'number');
    const totalScreen = screenSecondsArr.reduce((a, b) => a + b, 0);
    const avgScreen = screenSecondsArr.length ? totalScreen / screenSecondsArr.length : 0;

    const reflections = challenges
      .map(c => c.reflection)
      .filter(r => r && typeof r.moodBefore === 'number' && typeof r.moodAfter === 'number');
    const avgMoodDelta = reflections.length
      ? reflections.reduce((s, r) => s + ((r!.moodAfter! - r!.moodBefore!)), 0) / reflections.length
      : 0;

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    let streak = 0;
    for (let i = 0; i < 60; i++) {
      const d = new Date(today);
      d.setDate(d.getDate() - i);
      const key = d.toDateString();
      const has = challenges.some(ch => {
        if (ch.status !== 'completed') return false;
        const at = new Date(ch.completedAt || ch.issuedAt);
        return at.toDateString() === key;
      });
      if (has) streak++;
      else if (i === 0) continue;
      else break;
    }

    return json(c, {
      period,
      aggregates: agg,
      summary: {
        issued, completed, skipped, failed, completionRate, streak,
        totalScreenSeconds: totalScreen,
        avgScreenSeconds: avgScreen,
        avgMoodDelta,
      },
      byCategory,
    });
  } catch (e: any) {
    return err(c, 'Unable to load aggregates', 500, e?.message);
  }
});

const ScreenTimeBody = z.object({
  userId: z.string().min(1).optional(),
  challengeId: z.string().optional(),
  seconds: z.number().min(0).max(86400),
  date: z.string().optional(),
});

app.post('/api/screen-time', async (c) => {
  const parsed = await requireBody(c, ScreenTimeBody);
  if (!parsed.ok) return err(c, 'Invalid screen time payload', 400, parsed.issues);
  const { userId = 'anonymous-user', challengeId, seconds } = parsed.value;
  try {
    if (challengeId) {
      const all = await repos.challenges.getRecent(userId, 90);
      const ch = all.find(x => x.id === challengeId);
      if (ch) {
        ch.screenSeconds = (ch.screenSeconds || 0) + seconds;
        await repos.challenges.save(ch);
      }
    }
    await repos.events.log({
      ts: new Date(parsed.value.date || new Date()),
      userId,
      challengeId: challengeId,
      eventType: 'screen_time',
      screenSeconds: seconds,
    });
    return json(c, { logged: true, seconds, challengeId: challengeId || null });
  } catch (e: any) {
    return err(c, 'Unable to log screen time', 500, e?.message);
  }
});

app.post('/api/sync/batch', async (c) => {
  const userId = c.req.query('userId') || 'anonymous-user';
  let body: any;
  try { body = await c.req.json(); } catch { body = {}; }
  const items: Array<{ type: string; payload: any; ts?: string }> = Array.isArray(body?.items) ? body.items : [];
  const results: Array<{ ok: boolean; type: string; id?: string; error?: string }> = [];
  for (const item of items.slice(0, 200)) {
    try {
      switch (item.type) {
        case 'screen_time': {
          await repos.events.log({
            ts: new Date(item.ts || new Date()),
            userId,
            eventType: 'screen_time',
            screenSeconds: Number(item.payload?.seconds) || 0,
          });
          results.push({ ok: true, type: item.type });
          break;
        }
        case 'verify': {
          const all = await repos.challenges.getRecent(userId, 90);
          const ch = all.find(x => x.id === item.payload?.challengeId);
          if (!ch) { results.push({ ok: false, type: item.type, error: 'challenge not found' }); break; }
          if (item.payload?.proofType === 'honor' || item.payload?.honorConfirm) {
            ch.status = 'completed';
            ch.verification = {
              pass: true, confidence: 1, reason: 'Offline sync - honor system',
              attempts: 1, honorSystem: true,
            };
            ch.completedAt = new Date(item.ts || new Date());
            await repos.challenges.save(ch);
            await repos.events.log({
              ts: new Date(item.ts || new Date()),
              userId, challengeId: ch.id, eventType: 'completed',
              category: ch.category, difficulty: ch.difficulty,
            });
            results.push({ ok: true, type: item.type, id: ch.id });
          } else {
            results.push({ ok: false, type: item.type, error: 'verification requires online processing' });
          }
          break;
        }
        default:
          results.push({ ok: false, type: item.type || 'unknown', error: 'unsupported type' });
      }
    } catch (e: any) {
      results.push({ ok: false, type: item.type, error: e?.message || 'sync error' });
    }
  }
  return json(c, {
    processed: results.length,
    succeeded: results.filter(r => r.ok).length,
    failed: results.filter(r => !r.ok).length,
    results,
  });
});

app.get('/api/config', (c) => {
  return json(c, {
    providerMode: process.env.PROVIDER_MODE || 'mock',
    storeMode: process.env.STORE_MODE || 'mock',
    defaultCity: process.env.DEFAULT_CITY || 'Hyderabad, India',
    appBaseUrl: process.env.APP_BASE_URL || `http://localhost:${process.env.PORT || 3000}`,
    difficultyTarget: {
      min: Number(process.env.DIFFICULTY_TARGET_MIN || 0.6),
      max: Number(process.env.DIFFICULTY_TARGET_MAX || 0.7),
    },
    categories: ['nature', 'movement', 'sport', 'social-light', 'social-bold', 'creative', 'mindful', 'sensory', 'style', 'community', 'exploration'],
    proofTypes: ['photo', 'strava_screenshot', 'voice_note', 'honor'],
  });
});

async function createDailyChallenge(c: any) {
  try {
    const body = await c.req.json().catch(() => ({}));
    const userId = body.userId || 'anonymous-user';
    return json(c, await runDailyChallenge(userId));
  } catch (e: any) {
    return err(c, 'Challenge generation temporarily unavailable', 500, e.message);
  }
}

async function verifyChallengeCompat(c: any) {
  try {
    const body = await c.req.json().catch(() => ({}));
    if (!body.challengeId) return err(c, 'challengeId is required', 400);
    const userId = body.userId || 'anonymous-user';
    const all = await repos.challenges.getRecent(userId, 90);
    const challenge = all.find(ch => ch.id === body.challengeId);
    if (!challenge) return err(c, 'Challenge not found', 404);
    const result = await runVerifyProof(
      {
        challengeId: body.challengeId,
        userId,
        proofType: body.proofType || 'photo',
        imageBase64: body.imageBase64,
        honorConfirm: body.honorConfirm ?? true,
        screenSeconds: body.screenSeconds,
      },
      provider,
      challenge,
      {
        saveChallenge: (ch: Challenge) => repos.challenges.save(ch),
        logEvent: (e: AppEvent) => repos.events.log(e),
      },
    );
    return json(c, {
      pass: result.pass,
      confidence: result.confidence,
      reason: result.reason,
      needs_retake: result.needsRetake,
      honorSystem: result.honorSystem,
      status: result.status,
      extractedData: result.extractedData,
    });
  } catch (e: any) {
    return err(c, 'Proof verification temporarily unavailable', 500, e.message);
  }
}

app.post('/dev/run-daily', createDailyChallenge);
app.post('/dev/verify', verifyChallengeCompat);

app.post('/dev/seed', async (c) => {
  const userId = c.req.query('userId') || 'anonymous-user';
  const count = Math.min(50, Number(c.req.query('count') || 10));
  const created: Challenge[] = [];
  for (let i = 0; i < count; i++) {
    const res = await runDailyChallenge(userId);
    const ch = res.challenge as Challenge;
    const roll = Math.random();
    if (roll < 0.6) {
      ch.status = 'completed';
      ch.verification = { pass: true, confidence: 0.85 + Math.random() * 0.15, reason: 'Seeded as completed', attempts: 1, honorSystem: Math.random() < 0.3 };
      ch.completedAt = new Date(Date.now() - i * 24 * 3600 * 1000);
    } else if (roll < 0.8) {
      ch.status = 'skipped';
    } else {
      ch.status = 'failed';
    }
    ch.issuedAt = new Date(Date.now() - i * 24 * 3600 * 1000);
    ch.createdAt = new Date(Date.now() - i * 24 * 3600 * 1000);
    ch.screenSeconds = Math.floor(Math.random() * 180);
    await repos.challenges.save(ch);
    created.push(ch);
  }
  return json(c, { seeded: created.length, challenges: created.map(c => ({ id: c.id, status: c.status, date: c.issuedAt })) });
});

app.onError((error, c) => {
  if (process.env.SENTRY_DSN) Sentry.captureException(error);
  console.error('Unhandled error:', error);
  return json(c, { error: 'Internal server error', ...(process.env.NODE_ENV === 'development' ? { detail: String(error) } : {}) }, 500);
});

app.notFound((c) => {
  return json(c, { error: 'Not found', path: c.req.path, method: c.req.method }, 404);
});

const port = Number(process.env.PORT) || 3000;
console.log(`Touch Grass API starting on port ${port} (mode: ${process.env.PROVIDER_MODE || 'mock'}, store: ${process.env.STORE_MODE || 'mock'})...`);

serve({
  fetch: app.fetch,
  port,
});
