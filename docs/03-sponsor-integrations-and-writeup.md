# 03 — Sponsor Integrations, Write-Up Outline, and Field-Test Plan

## Sponsor Integration Map

### Featured Sponsors

---

#### Render (Hosting + Deploy)

**Job:** Host the entire production stack via `render.yaml` Blueprint.

**Files:**
- `render.yaml` — Blueprint defining web service (API + PWA), Python service (TabPFN), cron job
- `apps/api/src/index.ts` — Health check endpoint
- `Dockerfile` or build commands in render.yaml

**Evidence to capture:**
- Screenshot of Render dashboard showing all three services running
- Screenshot of a successful deploy log
- Screenshot of cron job execution log
- Health check response
- Render URL serving the PWA

---

#### TabPFN (Personalization Scoring)

**Job:** Predict challenge completion probability from tabular user history to target ~0.6–0.7 difficulty.

**Files:**
- `services/tabpfn/main.py` — FastAPI service with `/score` and `/health`
- `services/tabpfn/scorer.py` — TabPFN client integration
- `services/tabpfn/heuristic.py` — Offline heuristic fallback scorer
- `ml/synthetic/generate-users.ts` — Generate ~30 synthetic user histories
- `apps/api/src/tools/tabpfn.ts` — Mastra tool wrapping the TabPFN service call

**Evidence to capture:**
- TabPFN scoring response with real candidate rows
- Comparison: TabPFN predictions vs heuristic fallback on the same inputs
- Screenshot of the Python service logs showing latency
- Sentry trace of a scoring call

---

#### Tinker (Fine-Tune + Eval)

**Job:** LoRA fine-tune a small open-weight model to write better challenges than prompted baselines.

**Files:**
- `ml/tinker/generate-dataset.ts` — Generate seed tuples → teacher-written challenges
- `ml/tinker/filter.ts` — Filter by schema validity, dedup, safety
- `ml/tinker/train.ts` — Tinker API training job
- `ml/tinker/eval.ts` — Head-to-head eval (base prompted vs tuned)
- `ml/tinker/results/eval.md` — Results table

**Evidence to capture:**
- `eval.md` with JSON validity rate, duplicate rate, safety-pass rate, latency, cost, 10 side-by-side samples
- Tinker dashboard screenshot showing training job
- Screenshot of weight export/download (portability evidence)
- Sentry trace of tuned-writer call vs Gemma fallback

---

#### Gemma (Primary Model — Vision + Text)

**Job:** Vision verification (photo proof, Strava screenshots), text generation (challenges, reflections, reports), mood extraction.

**Files:**
- `apps/api/src/providers/hosted.ts` — Hosted Gemma provider
- `apps/api/src/providers/local.ts` — Local Gemma via Ollama
- `apps/api/src/workflows/verify.ts` — Verification workflow
- `apps/api/src/workflows/daily-challenge.ts` — Challenge generation (when tuned writer is off)
- `ml/local-bench/bench.ts` — Local Gemma benchmark

**Evidence to capture:**
- Verification verdicts on fixture photos (pass and fail sets)
- Strava screenshot extraction results
- Local-mode benchmark table (tokens/sec, latency, RAM)
- Side-by-side: hosted vs local mode verdicts on same images
- Sentry traces showing Gemma call latency and token usage

---

### Partner Sponsors

---

#### Mastra (Agent Framework)

**Job:** Orchestrate all AI workflows — daily challenge generation, proof verification, evening reflection, weekly report.

**Files:**
- `apps/api/src/agents/` — Agent definitions
- `apps/api/src/workflows/` — Workflow definitions (daily challenge, verify, reflect, report)
- `apps/api/src/tools/` — Tool definitions (SerpApi, TabPFN, Mongo, Tiger, ElevenLabs, etc.)

**License:** MIT (verify and state in README).

**Evidence to capture:**
- Workflow execution trace showing all steps
- Screenshot of Mastra dashboard (if available)
- Sentry trace of a full daily-challenge workflow with all tool calls visible
- Error handling: screenshot of a workflow recovering from a model failure

---

#### MongoDB Atlas (App Data + Vector Search)

**Job:** Primary app database — challenges, user profiles, events, memory. Atlas Vector Search for challenge dedup.

**Files:**
- `apps/api/src/db/mongo.ts` — MongoDB repository implementation
- `apps/api/src/db/interface.ts` — Repository interfaces
- Vector index definitions in `docs/04`

**Evidence to capture:**
- Atlas dashboard screenshot showing collections and indexes
- Vector search query returning similar past challenges
- Dedup in action: a near-duplicate challenge detected and regenerated
- Sentry trace of database operations

---

#### Tiger Data (Event Log + Analytics)

**Job:** Time-series event log (challenge issued, completed, skipped, reflection) and continuous aggregates for streaks, weekly stats, completion patterns.

**Files:**
- `apps/api/src/db/tiger.ts` — Tiger Data repository implementation
- SQL migrations for hypertable and continuous aggregates

**Evidence to capture:**
- Tiger Data dashboard showing the events hypertable
- Continuous aggregate query results (weekly completion rate, completion by hour)
- Weekly Grass Report using Tiger aggregates
- Sentry trace of event logging and aggregate queries

---

#### Sentry (Agent Tracing + Observability)

**Job:** Instrument all AI/agent calls, workflow steps, tool calls, and errors with Sentry tracing.

**Files:**
- `apps/api/src/telemetry/sentry.ts` — Sentry initialization and helpers
- Span instrumentation throughout workflows, providers, and tools

**Evidence to capture:**
- Sentry dashboard screenshot showing transaction traces
- AI call trace with latency and token usage
- Error capture with context (e.g., JSON parse failure and recovery)
- One real debugging story: a problem found via Sentry traces

---

#### ElevenLabs (Voice — TTS + STT)

**Job:** Audio-first challenge delivery (TTS) and voice reflection transcription (STT). With on-device fallbacks.

**Files:**
- `apps/api/src/tools/elevenlabs.ts` — ElevenLabs adapter
- `apps/web/src/lib/speech.ts` — Browser speechSynthesis fallback
- `apps/api/src/workflows/reflect.ts` — Reflection workflow using STT

**Evidence to capture:**
- Audio clip of a challenge read by ElevenLabs
- Same challenge read by browser speechSynthesis (fallback comparison)
- STT transcription of a voice reflection
- Sentry trace of TTS/STT calls

---

#### SerpApi (Search Grounding)

**Job:** Ground challenges in real-world context — nearby parks, courts, venues, local events, weather, sunset time.

**Files:**
- `apps/api/src/tools/serpapi.ts` — SerpApi adapter with fallback
- Cached/default data for offline fallback

**Evidence to capture:**
- SerpApi response for a city query (e.g., "basketball courts near Hyderabad")
- Challenge that uses grounded location info
- Fallback behavior when SerpApi is unavailable
- Sentry trace of a SerpApi call

---

#### Backboard (Multi-Model Comparison)

**Job:** Run the same eval set across multiple open-weight models and compare quality.

**Files:**
- `ml/backboard/compare.ts` — Comparison script
- Results output

**Evidence to capture:**
- Comparison table across models (JSON validity, safety, diversity, latency)
- Analysis of which model(s) performed best for challenge writing vs verification

---

#### ElevenLabs — see above (combined TTS/STT)

#### Entire (Session Capture)

**Job:** Capture agent development sessions for the write-up.

**Files:**
- Documentation in `docs/10` with steps for session capture

**Evidence to capture:**
- Link to a captured development session showing workflow debugging
- Session showing the fine-tune pipeline

---

#### GitHub Copilot

**Job:** Development assistance with project-specific conventions.

**Files:**
- `.github/copilot-instructions.md` — Project conventions

**Evidence to capture:**
- Screenshot of Copilot assisting with a project-specific pattern
- The copilot-instructions.md file itself

---

## Write-Up Outline

> This outline mirrors the challenge's judging questions. Every point must be backed by built features and measured data. Never claim what wasn't tested.

### 1. What It Is and How It Gets People Off the Screen

- Touch Grass: a daily real-world challenge agent. One challenge per day, audio-first delivery, minimal screen interaction.
- The screen-time principle: measured `screen_seconds` per day via Page Visibility API. Include the actual numbers from field testing.
- Demo flow: open app → hear challenge (< 5 sec) → go outside → snap proof → pocket phone → get verdict later.
- Example challenges with real verification verdicts.

### 2. Why Open Matters Here

#### Offline / Laptop
- Local mode works with no internet: single quantized Gemma via Ollama, all processing on-device.
- Cite the local-mode benchmark (tokens/sec, latency, RAM on 8 GB machine).
- PWA caches challenge for offline use; proof queued and synced later.
- What doesn't work offline (be honest): SerpApi grounding, TabPFN scoring, Tinker-tuned writer.

#### Data Stays With You
- Per-mode data-flow table from docs/09.
- Local mode: raw photos never leave the device; stored and verified locally.
- Hosted mode: images sent to model provider only, deleted after verification.
- No tracking, no analytics beyond what the user sees.

#### Fine-Tune, Swap Models, Change Behavior
- `PROVIDER_MODE` env var switches the entire model stack.
- Tinker fine-tune produces downloadable LoRA weights (verify export steps).
- Backboard comparison shows multiple models evaluated on the same tasks.
- All model prompts and schemas are in the codebase, auditable and modifiable.

#### Cost
- Cost table per 1,000 challenges:
  - Prompted (hosted Gemma): $X (measured from token usage)
  - Tuned (Tinker sampling): $X
  - Local: $0 (hardware cost only)

#### Where Open Worked Better Than Closed
- Only claim what the evidence supports.
- Likely advantages: privacy (no data to OpenAI), cost (local = free), customization (fine-tune on your data), portability (download weights), transparency (audit the prompts).
- Honestly note: closed models may have better raw quality for some tasks. Our eval table shows the tradeoff.

### 3. Open Pieces Used
- **Gemma** — open-weight, vision-capable, runs locally
- **Small open Qwen** (via Tinker) — fine-tuned for challenge writing, weights downloadable
- **Open embedding model** — for dedup and similarity search
- **Mastra** — open-source agent framework (MIT license)
- **Ollama** — open-source local model runtime
- **Repository** — MIT licensed, fully public

### 4. Sponsor-by-Sponsor Evidence Checklist

| Sponsor | Evidence | Status |
|---|---|---|
| Render | Dashboard, deploy log, cron log, live URL | ⬜ |
| TabPFN | Scoring response, comparison w/ heuristic, Sentry trace | ⬜ |
| Tinker | eval.md, dashboard, weight export, Sentry trace | ⬜ |
| Gemma | Verification verdicts, benchmark, Sentry traces | ⬜ |
| Mastra | Workflow traces, error recovery | ⬜ |
| MongoDB | Atlas dashboard, vector search, dedup example | ⬜ |
| Tiger Data | Dashboard, aggregates, weekly report | ⬜ |
| Sentry | Transaction traces, debugging story | ⬜ |
| ElevenLabs | Audio clips (ElevenLabs vs fallback), STT transcript | ⬜ |
| SerpApi | Grounded challenge, fallback behavior | ⬜ |
| Backboard | Multi-model comparison table | ⬜ |
| Entire | Session capture link | ⬜ |
| GitHub Copilot | copilot-instructions.md, usage screenshot | ⬜ |

### 5. Honest Limitations
- Local mode on 8 GB CPU-only machine: slow inference (cite actual benchmark).
- Cold-start data is synthetic (labeled as such).
- Screenshot verification can be spoofed (known limitation; honor-system fallback).
- Social challenges rely on honor system.
- Tiger Data is a stretch goal; events fall back to MongoDB.
- Full offline `STORE_MODE=local` is a stretch goal.

---

## Field-Test Plan

### Purpose
The challenge brief gives bonus points for "taking it outside, using it, and reporting how it went." This section provides a structured plan and log template.

### Plan
1. Complete at least 3 field tests on different days/locations.
2. Test both `hosted` and `local` modes.
3. Test at least one low-signal scenario (trail, park edge).
4. Test photo proof, honor-system proof, and (if possible) Strava screenshot proof.
5. Measure actual screen time per session using the app's own tracking.
6. Be honest about what broke.

### Field-Test Log Template

| # | Date | Place Type | Signal? | Challenge | Proof Method | Mode | Screen Secs | What Broke | What Worked | Honest Quote |
|---|---|---|---|---|---|---|---|---|---|---|
| 1 | | | | | | | | | | |
| 2 | | | | | | | | | | |
| 3 | | | | | | | | | | |
| 4 | | | | | | | | | | |
| 5 | | | | | | | | | | |

**Instructions:** Fill this table after actually going outside and using the app. Do not fabricate entries. If you only completed 2 tests, only fill 2 rows. If something broke badly, say so — that's more credible than a perfect record.

### What to Capture During Each Test
- Screenshot of the Today screen (for the write-up)
- The proof photo/screenshot you submitted
- The verification verdict
- The screen-time number from the History screen
- A brief voice or text reflection (what was it like?)
- Note the signal situation and whether offline features worked
