# 04 — Data Models

## Overview

Three storage backends share common interfaces:
- **MongoDB Atlas** — primary app data + vector search (hosted mode default)
- **Tiger Data / TimescaleDB** — time-series event log + continuous aggregates
- **SQLite** — local-only fallback (`STORE_MODE=local`)

Selected by `STORE_MODE`: `hosted` (Mongo + Tiger), `mongo-only` (Mongo for everything, Tiger events logged to Mongo), `local` (SQLite for everything).

---

## MongoDB Atlas Collections

### `challenges`

```json
{
  "_id": "ObjectId",
  "id": "string (ULID)",
  "userId": "string (anonymous UUID)",
  "title": "string",
  "description": "string",
  "category": "string (enum: nature|movement|sport|social-light|social-bold|creative|mindful|sensory|style|community|exploration)",
  "difficulty": "number (1-5)",
  "socialLevel": "number (0-3)",
  "estimatedMinutes": "number",
  "proofType": "string (enum: photo|strava_screenshot|voice_note|honor)",
  "proofRubric": "string (what the verifier checks for)",
  "safetyNotes": "string | null",
  "locationHint": "string | null",
  "tags": ["string"],
  "seed": {
    "category": "string",
    "placeType": "string",
    "constraint": "string",
    "difficulty": "number",
    "socialLevel": "number",
    "proofType": "string"
  },
  "sourceModel": "string (e.g. 'gemma-3-4b-it', 'tinker:qwen3.5-4b-lora')",
  "embedding": [0.0, "...", 0.0],  // 768-dim or model-specific
  "status": "string (enum: issued|completed|failed|skipped|expired)",
  "verification": {
    "pass": "boolean",
    "confidence": "number (0-1)",
    "reason": "string",
    "attempts": "number",
    "honorSystem": "boolean",
    "extractedData": "object | null"  // Strava fields, etc.
  },
  "reflection": {
    "summary": "string | null",
    "moodBefore": "number (1-5) | null",
    "moodAfter": "number (1-5) | null",
    "tags": ["string"]
  },
  "screenSeconds": "number | null",
  "audioUrl": "string | null",  // pre-generated TTS, deleted after expiry
  "synthetic": "boolean (default false)",
  "createdAt": "ISODate",
  "issuedAt": "ISODate",
  "completedAt": "ISODate | null",
  "expiresAt": "ISODate"
}
```

**Indexes:**
- `{ userId: 1, createdAt: -1 }` — user's challenge history
- `{ userId: 1, status: 1 }` — active challenges
- `{ "seed.category": 1, "seed.placeType": 1, "seed.constraint": 1, userId: 1 }` — dedup by seed
- `{ expiresAt: 1 }` — TTL index for cleanup (expiry after 90 days, configurable)

**Vector Search Index:**
```json
{
  "name": "challenge_embedding_index",
  "type": "vectorSearch",
  "definition": {
    "fields": [
      {
        "path": "embedding",
        "type": "vector",
        "numDimensions": 768,
        "similarity": "cosine"
      },
      {
        "path": "userId",
        "type": "filter"
      }
    ]
  }
}
```

---

### `users`

```json
{
  "_id": "ObjectId",
  "userId": "string (anonymous UUID, generated client-side)",
  "city": "string (default: 'Hyderabad, India')",
  "socialComfort": "number (0-3, default 1)",
  "optOutCategories": ["string"],
  "timezone": "string (IANA, default: 'Asia/Kolkata')",
  "providerMode": "string (hosted|local|mock)",
  "createdAt": "ISODate",
  "updatedAt": "ISODate"
}
```

**Indexes:**
- `{ userId: 1 }` — unique

---

### `backup_challenges`

A curated pool of hand-written challenges used as fallback when generation fails.

```json
{
  "_id": "ObjectId",
  "title": "string",
  "description": "string",
  "category": "string",
  "difficulty": "number",
  "socialLevel": "number",
  "estimatedMinutes": "number",
  "proofType": "string",
  "proofRubric": "string",
  "safetyNotes": "string | null",
  "tags": ["string"],
  "seed": { "..." }
}
```

---

## Tiger Data Tables (TimescaleDB)

### `events` (Hypertable)

```sql
CREATE TABLE events (
    ts              TIMESTAMPTZ     NOT NULL,
    user_id         TEXT            NOT NULL,
    challenge_id    TEXT,
    event_type      TEXT            NOT NULL,  -- 'issued', 'completed', 'failed', 'skipped', 'reflection', 'screen_time'
    category        TEXT,
    difficulty      SMALLINT,
    social_level    SMALLINT,
    weather         TEXT,           -- coarse: 'sunny', 'cloudy', 'rainy', etc.
    hour            SMALLINT,       -- hour of day in user's timezone
    minutes_taken   REAL,
    mood_before     SMALLINT,       -- 1-5
    mood_after      SMALLINT,       -- 1-5
    screen_seconds  REAL,
    synthetic       BOOLEAN         DEFAULT FALSE
);

SELECT create_hypertable('events', 'ts');

-- Index for user queries
CREATE INDEX idx_events_user_ts ON events (user_id, ts DESC);
CREATE INDEX idx_events_type ON events (event_type, ts DESC);
```

### Continuous Aggregates

```sql
-- Weekly completion rate
CREATE MATERIALIZED VIEW weekly_completion
WITH (timescaledb.continuous) AS
SELECT
    user_id,
    time_bucket('7 days', ts) AS week,
    COUNT(*) FILTER (WHERE event_type = 'issued') AS issued,
    COUNT(*) FILTER (WHERE event_type = 'completed') AS completed,
    COUNT(*) FILTER (WHERE event_type = 'skipped') AS skipped,
    COUNT(*) FILTER (WHERE event_type = 'failed') AS failed,
    AVG(screen_seconds) FILTER (WHERE screen_seconds IS NOT NULL) AS avg_screen_seconds,
    AVG(mood_after - mood_before) FILTER (WHERE mood_after IS NOT NULL) AS avg_mood_delta
FROM events
GROUP BY user_id, time_bucket('7 days', ts);

-- Completion by hour of day
CREATE MATERIALIZED VIEW hourly_completion
WITH (timescaledb.continuous) AS
SELECT
    user_id,
    time_bucket('1 day', ts) AS day,
    hour,
    COUNT(*) FILTER (WHERE event_type = 'completed') AS completed,
    COUNT(*) FILTER (WHERE event_type IN ('issued', 'completed', 'skipped', 'failed')) AS total
FROM events
GROUP BY user_id, time_bucket('1 day', ts), hour;

-- Completion by category
CREATE MATERIALIZED VIEW category_completion
WITH (timescaledb.continuous) AS
SELECT
    user_id,
    time_bucket('30 days', ts) AS month,
    category,
    COUNT(*) FILTER (WHERE event_type = 'completed') AS completed,
    COUNT(*) FILTER (WHERE event_type IN ('issued', 'completed', 'skipped', 'failed')) AS total,
    AVG(difficulty) AS avg_difficulty
FROM events
GROUP BY user_id, time_bucket('30 days', ts), category;
```

### Refresh Policy

```sql
SELECT add_continuous_aggregate_policy('weekly_completion',
    start_offset => INTERVAL '30 days',
    end_offset => INTERVAL '1 hour',
    schedule_interval => INTERVAL '1 hour');

SELECT add_continuous_aggregate_policy('hourly_completion',
    start_offset => INTERVAL '7 days',
    end_offset => INTERVAL '1 hour',
    schedule_interval => INTERVAL '1 hour');

SELECT add_continuous_aggregate_policy('category_completion',
    start_offset => INTERVAL '90 days',
    end_offset => INTERVAL '1 hour',
    schedule_interval => INTERVAL '6 hours');
```

---

## SQLite Schema (`STORE_MODE=local`)

Single file: `~/.touchgrass/data.sqlite`

```sql
CREATE TABLE challenges (
    id              TEXT PRIMARY KEY,
    user_id         TEXT NOT NULL,
    title           TEXT NOT NULL,
    description     TEXT NOT NULL,
    category        TEXT NOT NULL,
    difficulty      INTEGER NOT NULL,
    social_level    INTEGER NOT NULL,
    estimated_minutes INTEGER NOT NULL,
    proof_type      TEXT NOT NULL,
    proof_rubric    TEXT NOT NULL,
    safety_notes    TEXT,
    location_hint   TEXT,
    tags            TEXT NOT NULL,         -- JSON array
    seed            TEXT NOT NULL,         -- JSON object
    source_model    TEXT NOT NULL,
    embedding       BLOB,                 -- raw float32 array
    status          TEXT NOT NULL DEFAULT 'issued',
    verification    TEXT,                 -- JSON object
    reflection      TEXT,                 -- JSON object
    screen_seconds  REAL,
    audio_cached    INTEGER DEFAULT 0,
    synthetic       INTEGER DEFAULT 0,
    created_at      TEXT NOT NULL,
    issued_at       TEXT NOT NULL,
    completed_at    TEXT,
    expires_at      TEXT
);

CREATE INDEX idx_challenges_user ON challenges (user_id, created_at DESC);
CREATE INDEX idx_challenges_status ON challenges (user_id, status);
CREATE INDEX idx_challenges_seed ON challenges (user_id, category);

CREATE TABLE users (
    user_id             TEXT PRIMARY KEY,
    city                TEXT NOT NULL DEFAULT 'Hyderabad, India',
    social_comfort      INTEGER NOT NULL DEFAULT 1,
    opt_out_categories  TEXT NOT NULL DEFAULT '[]',  -- JSON array
    timezone            TEXT NOT NULL DEFAULT 'Asia/Kolkata',
    provider_mode       TEXT NOT NULL DEFAULT 'local',
    created_at          TEXT NOT NULL,
    updated_at          TEXT NOT NULL
);

CREATE TABLE events (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    ts              TEXT NOT NULL,
    user_id         TEXT NOT NULL,
    challenge_id    TEXT,
    event_type      TEXT NOT NULL,
    category        TEXT,
    difficulty      INTEGER,
    social_level    INTEGER,
    weather         TEXT,
    hour            INTEGER,
    minutes_taken   REAL,
    mood_before     INTEGER,
    mood_after      INTEGER,
    screen_seconds  REAL,
    synthetic       INTEGER DEFAULT 0
);

CREATE INDEX idx_events_user ON events (user_id, ts DESC);
CREATE INDEX idx_events_type ON events (event_type, ts DESC);

CREATE TABLE backup_challenges (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    title           TEXT NOT NULL,
    description     TEXT NOT NULL,
    category        TEXT NOT NULL,
    difficulty      INTEGER NOT NULL,
    social_level    INTEGER NOT NULL,
    estimated_minutes INTEGER NOT NULL,
    proof_type      TEXT NOT NULL,
    proof_rubric    TEXT NOT NULL,
    safety_notes    TEXT,
    tags            TEXT NOT NULL,
    seed            TEXT NOT NULL
);

-- Offline proof queue (for PWA offline sync)
CREATE TABLE proof_queue (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    challenge_id    TEXT NOT NULL,
    proof_type      TEXT NOT NULL,
    payload         BLOB,             -- image bytes or text
    created_at      TEXT NOT NULL,
    synced          INTEGER DEFAULT 0
);
```

---

## Retention Rules

| Data | Hosted (Atlas) | Hosted (Tiger) | Local (SQLite) |
|---|---|---|---|
| Challenges | 90-day TTL index; archived after | Retained in aggregates | No auto-delete; user can delete all |
| Events | No TTL (aggregated) | 1-year retention, then dropped | No auto-delete |
| Raw images | Deleted immediately after verification | N/A | Deleted immediately after verification |
| Raw audio | Deleted immediately after transcription | N/A | Deleted immediately after transcription |
| TTS audio cache | 48-hour TTL | N/A | Stored until next challenge |
| User profile | Until "Delete my data" | Until "Delete my data" | Until "Delete my data" |
| Embeddings | Same as challenge | N/A | Same as challenge |
| Synthetic data | Retained, labeled `synthetic: true` | Retained, labeled | Retained, labeled |

---

## "Delete My Data" Behavior

`DELETE /api/users/:userId/data`:
1. Delete all documents in `challenges` where `userId` matches.
2. Delete all rows in `events` where `user_id` matches.
3. Delete the `users` document.
4. Return `{ deleted: true, collections: ['challenges', 'events', 'users'] }`.
5. Log deletion event (with no PII) for audit.

In `STORE_MODE=local`: drop all rows from all tables where `user_id` matches, then VACUUM.
