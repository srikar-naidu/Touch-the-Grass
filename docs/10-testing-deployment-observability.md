# 10 — Testing, Deployment, and Observability

## Mock Mode (`PROVIDER_MODE=mock`)

Mock mode enables full UI development, CI testing, and workflow validation without any external dependencies.

### What's Mocked

| Component | Mock Behavior |
|---|---|
| **ModelProvider** | Returns canned JSON from `fixtures/responses/` |
| **ChallengeRepository** | In-memory store (reset each run) or SQLite |
| **EventRepository** | In-memory store |
| **UserRepository** | In-memory store with default user |
| **TabPFN** | Returns uniform 0.65 probability for all candidates |
| **ElevenLabs** | TTS: returns silence or a pre-recorded audio file; STT: returns canned transcript |
| **SerpApi** | Returns canned search results for default city |
| **Sentry** | No-op (no DSN) |
| **Tiger Data** | Skipped; events logged to in-memory store |

### Fixture Files

```
fixtures/
├── photos/
│   ├── pass/
│   │   ├── grass-touch.jpg         # Person touching grass
│   │   ├── park-bench.jpg          # Sitting in a park
│   │   ├── flower-collection.jpg   # Multiple flowers
│   │   ├── basketball-court.jpg    # On a basketball court
│   │   └── sunset-view.jpg         # Golden hour photo
│   └── fail/
│       ├── indoor-desk.jpg         # Clearly indoors
│       ├── blurry.jpg              # Too blurry to verify
│       ├── wrong-subject.jpg       # Doesn't match rubric
│       └── dark-photo.jpg          # Too dark
├── screenshots/
│   ├── strava-run-10min.png        # Valid 10-min run
│   ├── strava-walk-30min.png       # Valid 30-min walk
│   ├── strava-old-date.png         # Wrong date (should fail validation)
│   └── not-strava.png              # Not a Strava screenshot
└── responses/
    ├── challenge-nature.json       # Canned challenge output
    ├── challenge-sport.json
    ├── challenge-social.json
    ├── verification-pass.json      # Canned verification verdicts
    ├── verification-fail.json
    ├── verification-retake.json
    ├── strava-extraction.json
    ├── reflection.json
    ├── safety-pass.json
    ├── safety-fail.json
    ├── weekly-report.json
    └── serpapi-hyderabad.json       # Canned search results
```

### Response Replay Mode

The mock provider can load responses from `fixtures/responses/` based on a naming convention:

```typescript
// Mock provider looks up: fixtures/responses/{promptType}.json
// Where promptType is derived from the system prompt's purpose
// Example: "challenge-writer" → challenge-nature.json (random from available)
```

---

## Development Routes (`/dev/*`)

Available only when `NODE_ENV !== 'production'`:

| Route | Method | Purpose |
|---|---|---|
| `/dev/run-daily` | POST | Trigger the daily challenge workflow for a user |
| `/dev/run-daily?userId=X` | POST | Trigger for a specific user |
| `/dev/verify` | POST | Trigger verification with test data |
| `/dev/reflect` | POST | Trigger reflection with test data |
| `/dev/report` | POST | Trigger weekly report |
| `/dev/reset` | POST | Clear all data (mock/dev only) |
| `/dev/seed-data` | POST | Load synthetic users and history |

All `/dev/*` routes are **disabled in production** (checked via `NODE_ENV` and a middleware guard).

---

## Testing Strategy

### Unit Tests (Vitest)

| Area | Tests |
|---|---|
| **Seed sampler** | Respects exclusions, social comfort, opt-outs; generates required number of tuples; no duplicates in output |
| **Safety validator** | Catches all blocklist keywords; rejects night challenges after sunset; enforces social rules; adds safety notes to physical challenges |
| **Schema validation** | Validates correct challenges; rejects malformed; handles edge cases (empty strings, out-of-range numbers) |
| **Dedup** | Detects seed match, tag overlap, embedding similarity; respects threshold; counts attempts |
| **Strava validation** | Validates date is today (±1 day); validates minimum duration; rejects wrong activity type |
| **Heuristic scorer** | Returns values in [0.1, 0.95]; difficulty reduces score; streak increases score; matches expected patterns |
| **Workflow fallbacks** | Tinker failure → Gemma fallback; Gemma failure → backup pool; TabPFN failure → heuristic; ElevenLabs failure → browser speech |
| **Offline queue** | Enqueues proof when offline; dequeues and submits when online; handles duplicate submissions |
| **ModelProvider** | Mock provider returns canned responses; hosted provider constructs correct API calls; local provider constructs correct Ollama format |
| **Screen-time tracker** | Counts visible seconds correctly; persists across page navigations; resets daily |

### Integration Tests

| Test | Method |
|---|---|
| **Mock workflow smoke** | Run `POST /dev/run-daily` with `PROVIDER_MODE=mock`; verify a challenge is returned with valid schema |
| **Full daily workflow** | With mock provider, verify all steps execute: seed sampling → scoring → generation → dedup → safety → store |
| **Verification flow** | Submit a fixture photo to verification; verify verdict is returned |
| **Health checks** | Hit `/health` on API and TabPFN service; verify 200 |

### ML Eval Tests

| Test | Script | Description |
|---|---|---|
| **Verify-eval (hosted)** | `ml/local-bench/verify-eval.ts` | Run every image in `fixtures/photos/pass` and `fail` through the verification prompt with `PROVIDER_MODE=hosted`. Print expected vs actual. |
| **Verify-eval (local)** | Same script | Same test with `PROVIDER_MODE=local`. Compare results. |
| **Safety-eval** | `ml/tinker/eval.ts` | Run generated challenges through the safety validator. Report pass rate. |
| **Dedup-eval** | Custom script | Generate 50 challenges for one user and check that pairwise similarity stays below threshold. |

### Test Photo Set

The `fixtures/photos/` directory contains real photos (not AI-generated) for testing:

- **pass/**: photos that clearly match common challenge rubrics
- **fail/**: photos that clearly don't match (indoor, blurry, wrong subject)
- Photos are stripped of EXIF, resized to reasonable dimensions
- Licensed for open-source use (own photos or CC0)

---

## Camera Upload Testing

Testing camera upload from a phone through the dev environment:

1. **Local network (recommended for dev):**
   - Start the dev server: `npm run dev -- --host 0.0.0.0`
   - Access from phone via `http://<local-ip>:5173`
   - Note: Camera API requires HTTPS in most mobile browsers

2. **HTTPS tunnel (for camera API):**
   - Use `npx localtunnel --port 3000` or `ngrok http 3000`
   - Access the tunnel URL from phone
   - Camera capture and file upload both work over HTTPS

3. **PWA testing:**
   - Deploy to Render (auto-deploy on push)
   - Access the Render URL from phone
   - Test: camera capture, photo upload, offline caching, service worker

Document any browser-specific quirks (iOS Safari camera handling, Android Chrome permissions).

---

## Deployment (Render)

### `render.yaml` Blueprint

```yaml
services:
  # API + PWA web service
  - type: web
    name: touch-grass-api
    runtime: node
    plan: free
    buildCommand: npm ci && npm run build
    startCommand: npm run start
    healthCheckPath: /health
    envVars:
      - key: NODE_ENV
        value: production
      - key: PROVIDER_MODE
        sync: false    # set manually
      - key: STORE_MODE
        sync: false
      - key: GEMMA_BASE_URL
        sync: false
      - key: GEMMA_API_KEY
        sync: false
      - key: GEMMA_VISION_MODEL
        sync: false
      - key: GEMMA_TEXT_MODEL
        sync: false
      - key: MONGODB_URI
        sync: false
      - key: TIGER_DATABASE_URL
        sync: false
      - key: SENTRY_DSN
        sync: false
      - key: SENTRY_ENVIRONMENT
        value: production
      - key: ELEVENLABS_API_KEY
        sync: false
      - key: SERPAPI_API_KEY
        sync: false
      - key: TINKER_API_KEY
        sync: false
      - key: TINKER_BASE_MODEL
        sync: false
      - key: USE_TUNED_WRITER
        value: "false"
      - key: TABPFN_SERVICE_URL
        fromService:
          name: touch-grass-tabpfn
          type: web
          property: hostport
      - key: DEFAULT_CITY
        value: "Hyderabad, India"
      - key: APP_BASE_URL
        sync: false

  # TabPFN Python service
  - type: web
    name: touch-grass-tabpfn
    runtime: python
    plan: free
    buildCommand: pip install -r requirements.txt
    startCommand: uvicorn main:app --host 0.0.0.0 --port $PORT
    healthCheckPath: /health
    rootDir: services/tabpfn
    envVars:
      - key: TABPFN_TOKEN
        sync: false

  # Cron job for daily challenge generation
  - type: cron
    name: touch-grass-daily-cron
    runtime: node
    schedule: "0 * * * *"    # Every hour; job selects users whose morning has arrived
    buildCommand: npm ci && npm run build
    startCommand: npm run cron:daily
    envVars:
      - key: API_INTERNAL_URL
        fromService:
          name: touch-grass-api
          type: web
          property: hostport
```

### Deploy Checklist

1. ☐ Push code to GitHub
2. ☐ Connect Render to GitHub repo
3. ☐ Create Blueprint from `render.yaml`
4. ☐ Set all `sync: false` env vars manually in Render dashboard
5. ☐ Verify health checks pass for API and TabPFN services
6. ☐ Verify cron job is scheduled
7. ☐ Test `/dev/run-daily` is disabled in production
8. ☐ Test the PWA loads on mobile
9. ☐ Verify Sentry receives traces

### Environment Variables

See `.env.example` for the complete list with comments.

### Feature Flags

Every integration has a feature flag so a missing API key never crashes startup:

```typescript
const features = {
  serpapi: !!process.env.SERPAPI_API_KEY,
  elevenlabs: !!process.env.ELEVENLABS_API_KEY,
  tabpfn: !!process.env.TABPFN_SERVICE_URL,
  tiger: !!process.env.TIGER_DATABASE_URL,
  sentry: !!process.env.SENTRY_DSN,
  tunedWriter: process.env.USE_TUNED_WRITER === 'true' && !!process.env.TINKER_API_KEY,
};
```

---

## Observability (Sentry Agent Tracing)

### Setup

```typescript
import * as Sentry from '@sentry/node';

Sentry.init({
  dsn: process.env.SENTRY_DSN,  // no-op if absent
  environment: process.env.SENTRY_ENVIRONMENT || 'development',
  tracesSampleRate: 1.0,         // 100% in dev; reduce in production
  integrations: [
    // HTTP, Express/Hono, MongoDB integrations
  ],
});
```

### Instrumented Spans

| Transaction | Spans | Custom Data |
|---|---|---|
| `daily-challenge-workflow` | `load-profile`, `gather-context`, `sample-seeds`, `score-candidates`, `generate-challenge`, `dedup-check`, `safety-validation`, `store`, `generate-audio` | seedsConsidered, scoringMethod, sourceModel, dedupAttempts, totalLatencyMs |
| `verify-proof-workflow` | `load-challenge`, `process-proof`, `vision-call`, `update-store` | proofType, confidence, attempts, latencyMs |
| `reflection-workflow` | `transcribe`, `summarize`, `store` | hasVoice, latencyMs |
| `weekly-report-workflow` | `fetch-aggregates`, `generate-narrative`, `store` | challengeCount, completionRate, latencyMs |
| `ai-call` (child span) | — | model, provider, inputTokens, outputTokens, estimatedCost, latencyMs |
| `tool-call` (child span) | — | tool (serpapi/tabpfn/mongo/tiger/elevenlabs), latencyMs, success |

### Error Capture

```typescript
try {
  const result = await provider.generateText(opts);
} catch (error) {
  Sentry.captureException(error, {
    tags: {
      provider: config.PROVIDER_MODE,
      workflow: 'daily-challenge',
      step: 'generate-challenge',
    },
    extra: {
      model: opts.model,
      retryCount: attempt,
      // Never: image data, audio data, API keys, user content
    },
  });
}
```

### Write-Up Evidence Checklist (Sentry)

Capture these screenshots/traces for the write-up:

| Evidence | Description | ☐ |
|---|---|---|
| Dashboard overview | Sentry dashboard showing Touch Grass project | ☐ |
| Full workflow trace | A daily-challenge-workflow transaction with all spans visible | ☐ |
| AI call detail | An `ai-call` span showing model, tokens, latency | ☐ |
| Tool call detail | A `tool-call` span for SerpApi or TabPFN | ☐ |
| Error with context | A captured error showing the context tags | ☐ |
| Debugging story | One real bug found/fixed via Sentry (e.g., JSON parse failure, timeout, schema validation issue) | ☐ |
| Performance overview | Transaction latency distribution | ☐ |

---

## CI (GitHub Actions)

### `.github/workflows/ci.yml`

```yaml
name: CI

on:
  push:
    branches: [main]
  pull_request:
    branches: [main]

jobs:
  lint-and-test:
    runs-on: ubuntu-latest
    env:
      PROVIDER_MODE: mock
      STORE_MODE: mock
      NODE_ENV: test
    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: 'npm'

      - run: npm ci
      - run: npm run lint
      - run: npm run typecheck
      - run: npm run test

  smoke-test:
    runs-on: ubuntu-latest
    needs: lint-and-test
    env:
      PROVIDER_MODE: mock
      STORE_MODE: mock
      NODE_ENV: test
    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: 'npm'

      - run: npm ci
      - run: npm run build

      # Start the server in background
      - run: npm run start &
      - run: sleep 5

      # Health check
      - run: curl -f http://localhost:3000/health

      # Mock workflow smoke test
      - run: |
          curl -f -X POST http://localhost:3000/dev/run-daily \
            -H "Content-Type: application/json" \
            -d '{"userId": "test-user"}'

  python-test:
    runs-on: ubuntu-latest
    defaults:
      run:
        working-directory: services/tabpfn
    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-python@v5
        with:
          python-version: '3.11'

      - run: pip install -r requirements.txt
      - run: pytest
```

---

## Entire Session Capture

> **TODO(verify):** Verify Entire's exact documentation for session capture.

Planned steps:
1. Install Entire (verify: npm package, VS Code extension, or browser tool?)
2. Start a session before beginning a workflow debugging session
3. Capture the session showing:
   - A daily-challenge workflow execution
   - A bug being found and fixed via Sentry traces
   - The fine-tune pipeline running
4. Link the session in the write-up

This section will be updated after verifying Entire's documentation and API.

---

## GitHub Process Files

### `.github/copilot-instructions.md`

```markdown
# Touch Grass — Copilot Instructions

## Stack
- TypeScript (Node 20+), React + Vite PWA, Hono API server
- Mastra for AI agent workflows
- MongoDB Atlas + Tiger Data (TimescaleDB) + SQLite fallback
- FastAPI (Python) for TabPFN scoring service

## Key Rules
1. **Open-weight models only.** Never use GPT, Claude, or proprietary Gemini. All models must be open-weight.
2. **Three inference modes:** hosted, local, mock. Selected by PROVIDER_MODE env var. Same application code.
3. **Never load model weights in-process.** Models are always reached over HTTP.
4. **Safety rules are enforced in code** (blocklist + structural checks), not only in prompts.
5. **Every cloud service has a local/mock fallback.** Missing keys never crash startup.
6. **Delete raw media after processing.** Keep only verdicts and summaries.
7. **Minimize screen time.** Design for < 5 second interactions.

## Patterns
- Use `ModelProvider` interface for all model calls
- Use `Repository` interface for all data access
- Wrap AI calls and tool calls in Sentry spans
- Validate model output with zod schemas
- Use bounded retries with fallback chains
```

### `.github/pull_request_template.md`

```markdown
## What does this PR do?

## Which docs are affected?

## Testing
- [ ] Unit tests pass (`npm test`)
- [ ] Mock mode smoke test works (`POST /dev/run-daily`)
- [ ] No new TODO(verify) items without explanation
- [ ] Safety validator tested if challenge generation changed
- [ ] No raw media stored after processing

## Checklist
- [ ] No closed-model usage
- [ ] No hardcoded model IDs or API URLs
- [ ] No secrets committed
- [ ] Sentry spans added for new AI/tool calls
- [ ] Docs updated if implementation changed
```
