# 02 — Architecture

## High-Level Components

```
┌─────────────────────────────────────────────────────────────────────────┐
│                          TOUCH GRASS SYSTEM                            │
│                                                                        │
│  ┌──────────────┐    ┌───────────────────────────────────────────────┐ │
│  │  React PWA   │    │              API Server (Hono)                │ │
│  │  (Vite)      │◄──►│                                               │ │
│  │              │    │  ┌─────────┐ ┌───────────┐ ┌──────────────┐  │ │
│  │ • Today      │    │  │ Mastra  │ │ Providers │ │ Repositories │  │ │
│  │ • Prove It   │    │  │ Agents  │ │           │ │              │  │ │
│  │ • Verdict    │    │  │ & Work- │ │ • Hosted  │ │ • MongoDB    │  │ │
│  │ • History    │    │  │ flows   │ │ • Local   │ │ • Tiger Data │  │ │
│  │ • Report     │    │  │         │ │ • Mock    │ │ • SQLite     │  │ │
│  │ • Settings   │    │  └────┬────┘ └─────┬─────┘ └──────┬───────┘  │ │
│  │              │    │       │             │              │          │ │
│  │ SW + Offline │    │  ┌────┴─────────────┴──────────────┴───────┐  │ │
│  │ Queue        │    │  │           Tools & Adapters              │  │ │
│  └──────────────┘    │  │ • Safety Validator  • Taxonomy Sampler  │  │ │
│                      │  │ • Dedup Engine      • Screen-Time Log   │  │ │
│                      │  │ • SerpApi Adapter   • ElevenLabs Adapt. │  │ │
│                      │  │ • Sentry Telemetry  • Offline Sync      │  │ │
│                      │  └────────────────────────────────────────┘   │ │
│                      └───────────────────────────────────────────────┘ │
│                                                                        │
│  ┌──────────────────┐   ┌─────────────────────────────────────────┐   │
│  │ TabPFN Service   │   │         External Services               │   │
│  │ (FastAPI/Python) │   │ • Gemma (hosted endpoint)               │   │
│  │                  │   │ • Ollama / llama.cpp (local runtime)     │   │
│  │ POST /score      │   │ • Tinker (fine-tune + sampling)         │   │
│  │ GET /health      │   │ • MongoDB Atlas (+ Vector Search)       │   │
│  └──────────────────┘   │ • Tiger Data (TimescaleDB)              │   │
│                         │ • ElevenLabs (TTS/STT)                  │   │
│                         │ • SerpApi (search grounding)            │   │
│                         │ • Sentry (observability)                │   │
│                         │ • Backboard (multi-model eval)          │   │
│                         └─────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────────┘
```

## Data Flow

### Daily Challenge Generation

```
Cron/Manual Trigger
       │
       ▼
┌──────────────┐     ┌───────────┐     ┌────────────┐
│ Load Profile │────►│ Context   │────►│ Sample 20  │
│ + Memory     │     │ (weather, │     │ Seed Tuples│
│              │     │  SerpApi) │     │            │
└──────────────┘     └───────────┘     └─────┬──────┘
                                             │
       ┌─────────────────────────────────────┘
       ▼
┌──────────────┐     ┌───────────┐     ┌────────────┐
│ Score w/     │────►│ Select    │────►│ Generate   │
│ TabPFN or   │     │ ~0.6-0.7  │     │ via Writer │
│ Heuristic   │     │ prob seed │     │ (Tuned/    │
│              │     │           │     │  Gemma)    │
└──────────────┘     └───────────┘     └─────┬──────┘
                                             │
       ┌─────────────────────────────────────┘
       ▼
┌──────────────┐     ┌───────────┐     ┌────────────┐
│ Dedup Check  │────►│ Safety    │────►│ Store +    │
│ (seed match  │     │ Validator │     │ Log Event  │
│  + embedding)│     │ (code +   │     │ + Audio    │
│              │     │  model)   │     │            │
└──────────────┘     └───────────┘     └────────────┘
```

### Proof Verification

```
User Submits Proof
       │
       ├── Photo ──► Resize + Strip EXIF ──► Gemma Vision ──► Verdict
       │                                         │
       │                              confidence < 0.6 → Retry (max 2)
       │                              then → Honor-system accept
       │
       ├── Strava Screenshot ──► Gemma Vision Extract ──► User Confirms
       │                              │                    ──► Code Validates
       │
       ├── Voice Note ──► ElevenLabs STT (or skip) ──► Text Reflection
       │
       └── Honor System ──► User Confirms ──► Stored
       
       All raw media deleted after processing.
       Verdict + metadata stored. Event logged.
```

### Evening Reflection

```
Voice Note / Text Input
       │
       ▼
ElevenLabs STT (or text fallback)
       │
       ▼
Gemma Summary + Mood Extraction
       │
       ▼
Store: {summary, mood_before, mood_after, tags}
Delete: raw audio
Log: reflection event
```

---

## Three Runtime Modes

All modes use the same application code. The `ModelProvider` interface abstracts all model calls; the `Repository` interface abstracts all storage. Mode is selected by environment variables.

### Mode 1: `hosted` (Default for Render deploy)

| Concern | Implementation |
|---|---|
| **Models** | Open-weight models via cloud endpoints: Gemma for vision/text, tuned writer via Tinker sampling (optional), open embedding model for vectors |
| **Storage** | MongoDB Atlas (app data + vector search), Tiger Data (event log + aggregates) |
| **TTS/STT** | ElevenLabs |
| **Search** | SerpApi for location grounding |
| **Deploy** | Render Blueprint: API+PWA web service, TabPFN Python service, cron job |
| **Data flow** | Images sent to model provider for verification, then deleted. All text/metadata to Atlas/Tiger. |

### Mode 2: `local` (First-class, offline-capable)

| Concern | Implementation |
|---|---|
| **Models** | Single small quantized Gemma via local runtime (Ollama) on localhost HTTP. One model does everything. |
| **Storage** | SQLite file on device (stretch goal for full `STORE_MODE=local`; initially MongoDB still needed) |
| **TTS/STT** | Browser `speechSynthesis` (on-device). STT skipped; text reflection only. |
| **Search** | Skipped; cached/default local info. |
| **Deploy** | `npm run dev` + Ollama running locally |
| **Data flow** | **Nothing leaves the device.** Raw photos processed locally, verdicts stored locally. |
| **Constraints** | One model at a time. Images downscaled to max 512–768 px. Longer timeouts. Async verification with progress UI. |

### Mode 3: `mock` (Development + CI)

| Concern | Implementation |
|---|---|
| **Models** | Canned JSON responses from `fixtures/responses/` |
| **Storage** | In-memory or SQLite |
| **TTS/STT** | Canned audio / no-op |
| **Search** | Canned results |
| **Deploy** | `npm run dev` |
| **Data flow** | Nothing. All data is fixture data. |

---

## What Runs Where

| Component | Render | Local Dev | CI |
|---|---|---|---|
| API Server (Hono) | ✅ Web Service | ✅ `npm run dev` | ✅ Mock mode |
| React PWA | ✅ Static from API | ✅ Vite dev server | ✅ Build check |
| TabPFN Service | ✅ Python Service | ✅ `uvicorn` (optional) | ⬜ Mocked |
| Cron (daily gen) | ✅ Render Cron | ✅ `POST /dev/run-daily` | ✅ Mock trigger |
| Ollama / llama.cpp | ⬜ N/A | ✅ User-installed | ⬜ N/A |
| MongoDB Atlas | ✅ Cloud | ✅ Cloud or local Mongo | ⬜ In-memory |
| Tiger Data | ✅ Cloud | ✅ Cloud or skip | ⬜ Skipped |
| Sentry | ✅ Production | ✅ Development | ⬜ No DSN |

---

## Repository Layout

```
/
├── README.md
├── LICENSE
├── render.yaml
├── .env.example
├── package.json                 # Root workspace config
├── docs/                        # 10 design documents (source of truth)
├── apps/
│   ├── web/                     # React + Vite PWA
│   │   ├── public/
│   │   ├── src/
│   │   │   ├── components/
│   │   │   ├── pages/
│   │   │   ├── hooks/
│   │   │   ├── lib/
│   │   │   ├── sw.ts            # Service worker
│   │   │   └── App.tsx
│   │   ├── index.html
│   │   ├── vite.config.ts
│   │   └── package.json
│   └── api/
│       ├── src/
│       │   ├── index.ts         # Hono server entry
│       │   ├── agents/          # Mastra agent definitions
│       │   ├── workflows/       # Mastra workflows
│       │   ├── tools/           # Mastra tools
│       │   ├── providers/       # ModelProvider implementations
│       │   │   ├── interface.ts
│       │   │   ├── hosted.ts
│       │   │   ├── local.ts
│       │   │   └── mock.ts
│       │   ├── safety/          # Code-side safety validator
│       │   ├── taxonomy/        # Seed taxonomy + sampler
│       │   ├── db/              # Repository interfaces + implementations
│       │   │   ├── interface.ts
│       │   │   ├── mongo.ts
│       │   │   ├── tiger.ts
│       │   │   └── sqlite.ts
│       │   └── telemetry/       # Sentry setup + custom spans
│       ├── package.json
│       └── tsconfig.json
├── services/
│   └── tabpfn/                  # FastAPI Python service
│       ├── main.py
│       ├── scorer.py
│       ├── heuristic.py
│       ├── requirements.txt
│       └── Dockerfile
├── ml/
│   ├── tinker/                  # Fine-tune pipeline
│   │   ├── generate-dataset.ts
│   │   ├── filter.ts
│   │   ├── train.ts
│   │   ├── eval.ts
│   │   └── results/
│   ├── backboard/               # Multi-model comparison
│   │   └── compare.ts
│   ├── local-bench/             # Local mode benchmark
│   │   └── bench.ts
│   └── synthetic/               # Synthetic user data
│       └── generate-users.ts
├── fixtures/
│   ├── photos/
│   │   ├── pass/
│   │   └── fail/
│   ├── screenshots/
│   └── responses/
└── .github/
    ├── workflows/
    │   └── ci.yml
    ├── copilot-instructions.md
    └── pull_request_template.md
```

---

## Key Interfaces

### ModelProvider

```typescript
interface ModelProvider {
  generateText(opts: {
    systemPrompt: string;
    userPrompt: string;
    schema?: ZodSchema;
    maxTokens?: number;
    temperature?: number;
  }): Promise<{ text: string; parsed?: unknown; usage: TokenUsage }>;

  analyzeImage(opts: {
    systemPrompt: string;
    userPrompt: string;
    imageBase64: string;
    schema?: ZodSchema;
    maxTokens?: number;
  }): Promise<{ text: string; parsed?: unknown; usage: TokenUsage }>;

  embed(texts: string[]): Promise<number[][]>;
}
```

### Repository

```typescript
interface ChallengeRepository {
  save(challenge: Challenge): Promise<void>;
  getToday(userId: string): Promise<Challenge | null>;
  getRecent(userId: string, days: number): Promise<Challenge[]>;
  findSimilar(embedding: number[], threshold: number): Promise<Challenge[]>;
}

interface EventRepository {
  log(event: AppEvent): Promise<void>;
  getUserHistory(userId: string, limit: number): Promise<AppEvent[]>;
  getAggregates(userId: string, period: string): Promise<Aggregates>;
}

interface UserRepository {
  getProfile(userId: string): Promise<UserProfile>;
  updateProfile(userId: string, updates: Partial<UserProfile>): Promise<void>;
  deleteAll(userId: string): Promise<void>;
}
```

These interfaces have implementations for MongoDB+Tiger (hosted), SQLite (local), and in-memory (mock).
