# 05 — Agent Workflows

All workflows are implemented using **Mastra** (open-source agent framework, MIT license). Each workflow is a sequence of steps with typed inputs/outputs, error handling, and Sentry tracing.

---

## Workflow 1: Daily Challenge Generation

**Trigger:** Render cron job (hourly, selects users whose local morning has arrived) or `POST /dev/run-daily` (development).

**Input:**
```typescript
interface DailyChallengeInput {
  userId: string;
  forceRegenerate?: boolean;  // skip dedup/cooldown checks
}
```

**Output:**
```typescript
interface DailyChallengeOutput {
  challenge: Challenge;
  audioUrl: string | null;
  metadata: {
    seedsConsidered: number;
    seedSelected: SeedTuple;
    scoringMethod: 'tabpfn' | 'heuristic' | 'random';
    completionProbability: number;
    dedupAttempts: number;
    safetyChecks: number;
    sourceModel: string;
    totalLatencyMs: number;
  };
}
```

### Steps

```
Step 1: Load Profile + Memory
├── Input: userId
├── Action: Fetch user profile (city, socialComfort, optOutCategories, timezone)
│           Fetch recent challenges (last 30 days)
│           Fetch recent events (last 30 days) for scoring context
├── Output: { profile, recentChallenges, recentEvents }
└── Failure: If user not found, create default profile and continue

Step 2: Gather Context
├── Input: profile.city
├── Action: [Optional] SerpApi query for:
│           - Weather/sunset for today
│           - Nearby parks, courts, venues (coarse city-level)
│           - Local events or seasonal info
│           Fallback: use cached/default context (hardcoded for default city)
├── Output: { weather, sunset, nearbyPlaces[], localContext }
└── Failure: Skip grounding, use defaults. Log warning.

Step 3: Sample Seed Tuples
├── Input: profile, recentChallenges, context
├── Action: Generate ~20 candidate seed tuples from taxonomy
│           - Exclude recently used (category + placeType + constraint combos from last 14 days)
│           - Respect optOutCategories
│           - Respect socialComfort (filter seeds with socialLevel > comfort)
│           - Weight by context (prefer outdoor if sunny, indoor if rainy)
│           - Each tuple: { category, placeType, constraint, difficulty, socialLevel, proofType }
├── Output: { candidates: SeedTuple[] }
└── Failure: If fewer than 5 candidates after filtering, relax recency window

Step 4: Score Candidates
├── Input: candidates, recentEvents, profile
├── Action: Call TabPFN service (POST /score) with:
│           - Candidate features: category, difficulty, socialLevel, hour, weekday, weather
│           - User history features: streak, recent_skips, completion_rate_by_category
│           Returns: completion probability per candidate
│           Fallback: heuristic scorer (logistic function of difficulty, streak, category completion rate)
├── Output: { scoredCandidates: { seed, probability }[] }
├── Selection: Pick the candidate closest to 0.6-0.7 probability target
│              If fewer than 5 history entries, use rule-based pick:
│              difficulty 2-3, socialLevel <= comfort, random from filtered
└── Failure: Use rule-based random selection. Log warning.

Step 5: Generate Challenge
├── Input: selectedSeed, context, profile
├── Action: If USE_TUNED_WRITER=true and PROVIDER_MODE=hosted:
│             Call Tinker sampling API with seed + context
│           Else:
│             Call Gemma text generation with:
│             - System prompt (challenge writer persona)
│             - User prompt (seed tuple + context + constraints)
│             - JSON schema (Challenge schema via zod)
│             - maxTokens: 500, temperature: 0.8
│           Parse JSON output; validate with zod schema
├── Output: { challenge: Challenge (draft) }
├── Retry: On schema validation failure, retry up to 3 times with error feedback
│           On Tinker failure, fall back to Gemma
│           After 3 failures, select from backup_challenges pool
└── Failure: Return a random backup challenge. Log error.

Step 6: Dedup Check
├── Input: challenge, recentChallenges, userId
├── Action: 1. Seed match: check if any recent challenge has same category + placeType + constraint
│           2. Tag overlap: check if >70% tags overlap with any recent challenge
│           3. Embedding similarity: embed the challenge, query Atlas Vector Search
│              for userId with cosine similarity > 0.85
│           If duplicate detected: go back to Step 5 with a different seed
├── Output: { isDuplicate: boolean, similarChallenge?: Challenge }
├── Retry: Up to 3 regeneration attempts with different seeds
└── Failure: Accept the challenge with a "similar_to" flag. Log warning.

Step 7: Safety Validation
├── Input: challenge
├── Action: 1. Code-side validator (blocklist + structural checks):
│              - Keyword blocklist (trespass, illegal, dangerous, etc.)
│              - Structural rules (no night challenges past sunset, etc.)
│              - Social rules (consent-first, kind, skippable)
│           2. Model check: Gemma classifies the challenge as safe/unsafe
│              with a rubric of safety criteria
│           Either failing → reject
├── Output: { safe: boolean, reason?: string }
├── Retry: On unsafe, go back to Step 5 with a different seed (up to 3 total)
└── Failure: Return a backup challenge. Log the unsafe generation for review.

Step 8: Store + Log
├── Input: challenge (validated)
├── Action: 1. Generate embedding for the challenge
│           2. Save to challenges collection with status 'issued'
│           3. Log 'issued' event to Tiger Data (or Mongo events fallback)
├── Output: { challengeId: string }
└── Failure: Retry storage up to 2 times. On failure, return challenge without persistence (client can retry).

Step 9: Generate Audio
├── Input: challenge.title + challenge.description
├── Action: Call ElevenLabs TTS API
│           - Voice: configurable, default a warm/encouraging voice
│           - Format: mp3, 22050 Hz
│           Cache the audio file (CDN or local file)
│           Fallback: set audioFallback flag for client to use speechSynthesis
├── Output: { audioUrl: string | null, useFallback: boolean }
└── Failure: Set useFallback = true. Log warning.

Step 10: Sentry Wrap
├── All steps above are wrapped in Sentry spans:
│   - Transaction: 'daily-challenge-workflow'
│   - Spans: 'load-profile', 'gather-context', 'sample-seeds', 'score-candidates',
│            'generate-challenge', 'dedup-check', 'safety-validation', 'store', 'generate-audio'
│   - Custom data: seedsConsidered, scoringMethod, sourceModel, dedupAttempts, totalLatencyMs
└── Errors captured with context (never images or PII)
```

---

## Workflow 2: Proof Verification

**Trigger:** `POST /api/challenges/:id/verify` with proof payload.

**Input:**
```typescript
interface VerifyInput {
  challengeId: string;
  userId: string;
  proofType: 'photo' | 'strava_screenshot' | 'voice_note' | 'honor';
  imageBase64?: string;     // for photo and strava_screenshot
  voiceBase64?: string;     // for voice_note
  honorConfirm?: boolean;   // for honor
}
```

**Output:**
```typescript
interface VerifyOutput {
  pass: boolean;
  confidence: number;
  reason: string;
  needsRetake: boolean;
  honorSystem: boolean;
  extractedData?: {
    activityType?: string;
    distance?: string;
    duration?: string;
    date?: string;
  };
}
```

### Steps

```
Step 1: Load Challenge
├── Input: challengeId, userId
├── Action: Fetch the challenge from the database
│           Verify it belongs to the user and is in 'issued' status
├── Output: { challenge }
└── Failure: 404 if not found; 400 if wrong status

Step 2: Process by Proof Type

  [Photo]
  ├── Action: 1. Client already resized (max 1024px hosted, 512px local) and stripped EXIF
  │           2. Send image + proof_rubric to Gemma vision
  │           3. System prompt: "You are a proof verifier for outdoor challenges..."
  │           4. Response schema: { pass, confidence, reason, needs_retake }
  │           5. If confidence < 0.6 and attempts < 2: ask for retake
  │           6. After 2 attempts: accept as honor-system with flag
  ├── Output: VerifyOutput
  └── Failure: Accept as honor-system. Log error.

  [Strava Screenshot]
  ├── Action: 1. Client resized and stripped EXIF
  │           2. Send to Gemma vision with extraction prompt
  │           3. Response schema: { activity_type, distance, duration, date }
  │           4. Show extracted values to user for correction (UI step)
  │           5. CODE validates rules:
  │              - Date must be today (±1 day for timezone edge cases)
  │              - Duration meets challenge minimum (if specified)
  │              - Activity type matches challenge (if specified)
  │           6. Never use the Strava API
  ├── Output: VerifyOutput with extractedData
  └── Failure: Accept as honor-system with extracted data shown. Log error.

  [Voice Note]
  ├── Action: 1. Send audio to ElevenLabs STT (or skip if unavailable)
  │           2. Transcript → Gemma summary + mood extraction
  │           3. Store as reflection data
  │           4. Mark as honor-system pass (voice notes are self-reported)
  │           5. Delete raw audio after transcription
  ├── Output: VerifyOutput (always pass for voice notes)
  └── Failure: Accept text input instead. Log warning.

  [Honor System]
  ├── Action: 1. User confirmed completion
  │           2. Store as honor-system pass
  │           3. Optional voice reflection (triggers voice_note flow above)
  ├── Output: VerifyOutput (always pass, honorSystem: true)
  └── Failure: N/A

Step 3: Update Challenge + Log Event
├── Action: 1. Update challenge status to 'completed' or 'failed'
│           2. Store verification result
│           3. Delete raw image/audio from any temporary storage
│           4. Log event to Tiger Data / Mongo
│           5. Update screen_seconds for today
├── Output: { updated: true }
└── Failure: Retry storage. Challenge may show as unverified.

Step 4: Sentry Wrap
├── Transaction: 'verify-proof-workflow'
├── Spans: 'load-challenge', 'process-proof', 'vision-call', 'update-store'
└── Custom data: proofType, confidence, attempts, latencyMs
```

---

## Workflow 3: Evening Reflection

**Trigger:** `POST /api/challenges/:id/reflect` (user-initiated from app).

**Input:**
```typescript
interface ReflectionInput {
  challengeId: string;
  userId: string;
  voiceBase64?: string;   // optional voice note
  textInput?: string;     // text fallback
}
```

**Output:**
```typescript
interface ReflectionOutput {
  summary: string;
  moodBefore: number;     // 1-5
  moodAfter: number;      // 1-5
  tags: string[];
}
```

### Steps

```
Step 1: Transcribe (if voice)
├── Input: voiceBase64
├── Action: ElevenLabs STT → text transcript
│           Fallback: use textInput if STT unavailable
│           Delete raw audio after transcription
├── Output: { transcript: string }
└── Failure: Use textInput. If neither available, skip reflection.

Step 2: Summarize + Extract Mood
├── Input: transcript, challenge context
├── Action: Gemma text generation with:
│           - System prompt: "Summarize this reflection on an outdoor challenge..."
│           - Response schema: { summary, mood_before (1-5), mood_after (1-5), tags[] }
│           - maxTokens: 200
├── Output: ReflectionOutput
└── Failure: Store raw transcript as summary, mood = null. Log error.

Step 3: Store + Log
├── Action: 1. Update challenge with reflection data
│           2. Log 'reflection' event with mood data
├── Output: { stored: true }
└── Failure: Retry. Log error.

Step 4: Sentry Wrap
├── Transaction: 'reflection-workflow'
├── Spans: 'transcribe', 'summarize', 'store'
└── Custom data: hasVoice, latencyMs
```

---

## Workflow 4: Weekly Report

**Trigger:** Render cron (weekly, or when user opens the report screen and data is stale).

**Input:**
```typescript
interface WeeklyReportInput {
  userId: string;
  weekStart: string;  // ISO date
}
```

**Output:**
```typescript
interface WeeklyReportOutput {
  narrative: string;       // AI-generated narrative
  stats: {
    challengesIssued: number;
    challengesCompleted: number;
    challengesSkipped: number;
    completionRate: number;
    streakDays: number;
    totalScreenSeconds: number;
    avgScreenSeconds: number;
    avgMoodDelta: number;
    topCategory: string;
    hardestCompleted: number;  // max difficulty completed
  };
  highlights: string[];    // notable achievements
}
```

### Steps

```
Step 1: Fetch Aggregates
├── Input: userId, weekStart
├── Action: Query Tiger Data continuous aggregates (or Mongo events fallback):
│           - weekly_completion for this week
│           - category_completion for this week
│           - hourly_completion for this week
│           - Individual challenge records for narrative detail
├── Output: { stats, challenges[] }
└── Failure: Use Mongo events collection directly. Log warning.

Step 2: Generate Narrative
├── Input: stats, challenges[]
├── Action: Gemma text generation with:
│           - System prompt: "You are writing a warm, encouraging weekly summary..."
│           - User prompt: stats + challenge summaries + reflections
│           - maxTokens: 500, temperature: 0.7
│           - Include: screen time comparison ("you spent X seconds on the app, Y minutes outside")
├── Output: { narrative: string, highlights: string[] }
└── Failure: Return stats-only report without narrative. Log error.

Step 3: Store + Cache
├── Action: Cache the report for the week (avoid regeneration)
├── Output: WeeklyReportOutput
└── Failure: Return without caching.

Step 4: Sentry Wrap
├── Transaction: 'weekly-report-workflow'
├── Spans: 'fetch-aggregates', 'generate-narrative', 'store'
└── Custom data: challengeCount, completionRate, latencyMs
```

---

## Error Handling Philosophy

1. **Never crash.** Every workflow has a fallback path that produces a usable result.
2. **Bounded retries.** Model calls retry up to 3 times with exponential backoff. After 3 failures, fall back to the next option.
3. **Fallback chain:** Tuned writer → Prompted Gemma → Backup challenge pool.
4. **Graceful degradation:** Missing services (SerpApi, ElevenLabs, TabPFN, Tiger Data) are skipped with defaults; the core loop always works.
5. **Log everything to Sentry.** Errors include context (step name, input shape, retry count) but never images, audio, or PII.
6. **Idempotent where possible.** Re-running `run-daily` for a user who already has today's challenge returns the existing one.

---

## Workflow Registration (Mastra)

```typescript
// apps/api/src/workflows/index.ts
import { Mastra } from '@mastra/core';
import { dailyChallengeWorkflow } from './daily-challenge';
import { verifyProofWorkflow } from './verify';
import { reflectionWorkflow } from './reflect';
import { weeklyReportWorkflow } from './report';

export const mastra = new Mastra({
  workflows: {
    'daily-challenge': dailyChallengeWorkflow,
    'verify-proof': verifyProofWorkflow,
    'reflection': reflectionWorkflow,
    'weekly-report': weeklyReportWorkflow,
  },
  // agents, tools, etc.
});
```
