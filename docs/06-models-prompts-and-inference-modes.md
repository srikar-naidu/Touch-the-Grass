# 06 — Models, Prompts, and Inference Modes

## Model Inventory

| Role | Model | Mode: hosted | Mode: local | Mode: mock | Env Vars |
|---|---|---|---|---|---|
| **Vision verifier** | Gemma (vision-capable) | Cloud endpoint | Ollama (single model) | Canned JSON | `GEMMA_BASE_URL`, `GEMMA_API_KEY`, `GEMMA_VISION_MODEL` |
| **Text generator** (challenges, reflections, reports) | Gemma (text) | Cloud endpoint | Ollama (same model) | Canned JSON | `GEMMA_BASE_URL`, `GEMMA_API_KEY`, `GEMMA_TEXT_MODEL` |
| **Tuned challenge writer** | Small Qwen instruct via Tinker LoRA | Tinker sampling API | N/A (fallback to Gemma) | Canned JSON | `USE_TUNED_WRITER`, `TINKER_API_KEY`, `TINKER_BASE_MODEL` |
| **Embeddings** | Open embedding model (BGE-family or EmbeddingGemma) | Cloud endpoint | Ollama (if supported) or skip | Zero vectors | `EMBEDDING_BASE_URL`, `EMBEDDING_API_KEY`, `EMBEDDING_MODEL` |
| **Safety classifier** | Gemma (text) | Same as text generator | Same single model | Always "safe" | (shares Gemma vars) |
| **Teacher** (dataset gen only) | Gemma or larger open model | Cloud endpoint | N/A | N/A | `TEACHER_BASE_URL`, `TEACHER_API_KEY`, `TEACHER_MODEL` |

---

## Environment Variables

```bash
# Provider mode: hosted | local | mock
PROVIDER_MODE=hosted

# Gemma (hosted mode)
GEMMA_BASE_URL=          # e.g., https://generativelanguage.googleapis.com/v1beta or compatible endpoint
GEMMA_API_KEY=
GEMMA_VISION_MODEL=      # e.g., gemma-3-12b-it (must support vision)
GEMMA_TEXT_MODEL=         # e.g., gemma-3-4b-it

# Local mode (Ollama or llama.cpp server)
LOCAL_BASE_URL=http://localhost:11434  # Ollama default
LOCAL_MODEL=gemma3:4b                 # Single model for everything

# Embeddings
EMBEDDING_BASE_URL=
EMBEDDING_API_KEY=
EMBEDDING_MODEL=         # e.g., bge-large-en-v1.5 or embedding-gemma

# Tinker (fine-tuned writer, hosted only)
USE_TUNED_WRITER=false
TINKER_API_KEY=
TINKER_BASE_MODEL=       # Verify against Tinker's current model list

# Teacher model (for dataset generation only, not runtime)
TEACHER_BASE_URL=
TEACHER_API_KEY=
TEACHER_MODEL=
```

---

## System Prompts

### Challenge Writer

```
You are the Touch Grass challenge writer. Your job is to create ONE unique, specific, 
actionable outdoor challenge based on the provided seed tuple and context.

RULES:
- The challenge must get the person OFF their phone and INTO the real world.
- Be specific and vivid, not generic. "Go to a park" is bad. "Find a tree with peeling 
  bark in a park near you, touch it, and photograph the texture" is good.
- The challenge must be completable in the estimated time.
- The challenge must be verifiable with the specified proof type.
- Include a safety note if the activity has any physical component.
- Social challenges must be consent-first, kind, and easy to decline.
- Never suggest anything dangerous, illegal, or requiring money.
- Match the specified difficulty level (1=easy couch-to-door, 5=adventurous).
- Write the proof_rubric as instructions for a photo verifier: what should be visible?

Respond ONLY with valid JSON matching the provided schema.
```

### Photo Verifier

```
You are a proof verifier for the Touch Grass outdoor challenge app. You are given a 
photo and a rubric describing what the photo should show to prove challenge completion.

RULES:
- Judge ONLY based on the rubric. Does the photo show what the rubric requires?
- Be generous but honest. The person went outside and tried — give credit where due.
- confidence: 0.0-1.0. Use 0.8+ for clear matches, 0.4-0.6 for ambiguous, <0.4 for mismatches.
- needs_retake: true ONLY if the photo is blurry, dark, or clearly wrong but the person 
  might have the right thing nearby (e.g., took a photo of the wrong thing).
- reason: one sentence explaining your verdict.
- Never comment on people's appearance, race, gender, age, or body.
- If the photo contains faces, ignore them — focus only on the rubric criteria.

Respond ONLY with valid JSON: { "pass": boolean, "confidence": number, "reason": string, "needs_retake": boolean }
```

### Strava Screenshot Reader

```
You are reading a Strava activity screenshot. Extract the following fields if visible:
- activity_type: the type of activity (run, ride, walk, hike, swim, etc.)
- distance: the distance with units (e.g., "5.2 km")
- duration: the elapsed time (e.g., "32:15")
- date: the date of the activity (e.g., "Oct 8, 2026")

If a field is not visible or you're unsure, set it to null.

Respond ONLY with valid JSON: { "activity_type": string|null, "distance": string|null, "duration": string|null, "date": string|null }
```

### Mood/Reflection Summarizer

```
You are summarizing a brief reflection after an outdoor challenge. The person just 
completed (or attempted) the challenge described below.

From their reflection, extract:
- summary: 1-2 sentence summary of how it went and how they feel
- mood_before: their mood BEFORE the challenge on a 1-5 scale (1=low, 5=great). 
  Infer from context if not stated explicitly.
- mood_after: their mood AFTER the challenge on a 1-5 scale.
- tags: 2-4 descriptive tags (e.g., "refreshing", "social", "challenging", "peaceful")

Be warm and encouraging in the summary. Never judge or criticize.

Respond ONLY with valid JSON: { "summary": string, "mood_before": number, "mood_after": number, "tags": string[] }
```

### Weekly Report Narrator

```
You are writing a warm, encouraging weekly summary for a Touch Grass user. They 
completed outdoor challenges this week and you have their stats.

RULES:
- Be warm, genuine, and briefly funny if appropriate. Not corporate or cloying.
- Highlight the screen-time win: "You spent X seconds in the app and Y minutes outside."
- Mention their best day or most interesting challenge.
- If they completed a harder challenge than last week, celebrate the growth.
- If completion rate dropped, be encouraging, not guilt-inducing.
- Keep it under 150 words.
- End with a short motivational note about next week.
```

### Safety Classifier

```
You are a safety reviewer for outdoor challenge descriptions. Classify whether the 
challenge is SAFE or UNSAFE based on these criteria:

UNSAFE if any apply:
- Requires trespassing or entering private property
- Involves illegal activities
- Involves dangerous activities: heights, water hazards, traffic, fire, extreme weather, stunts
- Requires being alone outdoors at night
- Involves approaching, photographing, or recording strangers without consent
- Involves minors in any way
- Is confrontational, romantic, or requires sharing personal information
- Involves alcohol, drugs, or required spending
- Makes medical or health claims
- Could cause physical harm without an easy alternative

Respond ONLY with valid JSON: { "safe": boolean, "reason": string }
```

---

## JSON Schemas (Zod)

```typescript
// Challenge output schema
const ChallengeSchema = z.object({
  title: z.string().min(5).max(100),
  description: z.string().min(20).max(500),
  category: z.enum([
    'nature', 'movement', 'sport', 'social-light', 'social-bold',
    'creative', 'mindful', 'sensory', 'style', 'community', 'exploration'
  ]),
  difficulty: z.number().int().min(1).max(5),
  socialLevel: z.number().int().min(0).max(3),
  estimatedMinutes: z.number().int().min(2).max(120),
  proofType: z.enum(['photo', 'strava_screenshot', 'voice_note', 'honor']),
  proofRubric: z.string().min(10).max(300),
  safetyNotes: z.string().nullable(),
  locationHint: z.string().nullable(),
  tags: z.array(z.string()).min(2).max(6),
});

// Verification output schema
const VerificationSchema = z.object({
  pass: z.boolean(),
  confidence: z.number().min(0).max(1),
  reason: z.string().min(5).max(200),
  needs_retake: z.boolean(),
});

// Strava extraction schema
const StravaExtractionSchema = z.object({
  activity_type: z.string().nullable(),
  distance: z.string().nullable(),
  duration: z.string().nullable(),
  date: z.string().nullable(),
});

// Reflection schema
const ReflectionSchema = z.object({
  summary: z.string().min(10).max(300),
  mood_before: z.number().int().min(1).max(5),
  mood_after: z.number().int().min(1).max(5),
  tags: z.array(z.string()).min(2).max(4),
});

// Safety schema
const SafetySchema = z.object({
  safe: z.boolean(),
  reason: z.string(),
});
```

---

## Retry and Fallback Rules

### Model Call Retries

| Situation | Max Retries | Backoff | Action on Exhaust |
|---|---|---|---|
| JSON parse failure | 3 | 1s, 2s, 4s | Return raw text + flag |
| Schema validation failure | 3 | 1s, 2s, 4s | Retry with error message appended to prompt |
| Network error / timeout | 2 | 2s, 5s | Fall to next provider in chain |
| Rate limit (429) | 3 | Retry-After header or 30s | Fall to next provider |
| Server error (5xx) | 2 | 5s, 10s | Fall to next provider |

### Fallback Chain

```
Challenge Writing:
  Tinker tuned model → Gemma prompted → Backup challenge pool

Vision Verification:
  Gemma vision (hosted/local) → Honor-system accept after 2 attempts

Embeddings:
  Hosted embedding model → Local embedding model → Skip dedup (accept)

TabPFN Scoring:
  TabPFN service → Heuristic scorer → Random selection

TTS:
  ElevenLabs → Browser speechSynthesis

STT:
  ElevenLabs → Text input fallback

SerpApi:
  SerpApi → Cached/default context

Tiger Data:
  Tiger Data → MongoDB events collection
```

---

## Local-Mode Constraints

When `PROVIDER_MODE=local`:

| Constraint | Value | Reason |
|---|---|---|
| Models loaded | 1 (single small Gemma) | 8 GB RAM limit |
| Image max size | 512-768 px (longest edge) | Reduce inference time |
| Max output tokens | 300 (text), 150 (vision) | Reduce inference time |
| Timeout | 120s (vision), 60s (text) | Slow CPU inference |
| Verification mode | Async with progress UI | User shouldn't wait |
| Embeddings | Via same model if supported, else skip | One model constraint |
| Tuned writer | Disabled | Requires separate model |
| SerpApi | Disabled | Offline mode |
| TabPFN | Disabled (use heuristic) | Requires network |
| ElevenLabs | Disabled (use browser speech) | Offline mode |

---

## Local-Mode Benchmark Table

> Measured on: dev machine (8 GB RAM, no GPU, CPU-only)  
> Runtime: Ollama  
> Model: (to be determined after testing available models)

| Task | Model | Quantization | Image Size | Output Tokens | Latency (s) | Tokens/sec | Peak RAM (GB) |
|---|---|---|---|---|---|---|---|
| Challenge generation | — | — | N/A | — | not yet measured | not yet measured | not yet measured |
| Photo verification | — | — | 512px | — | not yet measured | not yet measured | not yet measured |
| Strava screenshot | — | — | 512px | — | not yet measured | not yet measured | not yet measured |
| Reflection summary | — | — | N/A | — | not yet measured | not yet measured | not yet measured |
| Safety classification | — | — | N/A | — | not yet measured | not yet measured | not yet measured |

> **Note:** This table will be filled with real measured numbers after running `ml/local-bench/bench.ts`.  
> Never invent numbers. If a task has not been benchmarked, leave it as "not yet measured".

---

## Open Verification Items

> Items marked `// TODO(verify)` in the codebase. Check each against official documentation before production use.

| Item | What to Verify | File | Status |
|---|---|---|---|
| Gemma vision model ID | Exact model string for the hosted endpoint that supports image input | `providers/hosted.ts` | ⬜ |
| Gemma API format | Whether the endpoint uses OpenAI-compatible format or Google's format | `providers/hosted.ts` | ⬜ |
| Ollama Gemma vision support | Whether Ollama supports the chosen Gemma variant with image input | `providers/local.ts` | ⬜ |
| Ollama API format for images | Exact format for passing base64 images to Ollama | `providers/local.ts` | ⬜ |
| Tinker model list | Current available base models on Tinker | `ml/tinker/train.ts` | ⬜ |
| Tinker training API | Exact API for starting LoRA SFT, dataset format, and weight export | `ml/tinker/train.ts` | ⬜ |
| Tinker sampling API | Exact API for inference with a trained LoRA | `providers/hosted.ts` | ⬜ |
| Backboard API | Exact API for multi-model comparison | `ml/backboard/compare.ts` | ⬜ |
| TabPFN client | Python client API and hosted endpoint | `services/tabpfn/scorer.py` | ⬜ |
| ElevenLabs TTS API | Current API version, voice IDs, audio format | `tools/elevenlabs.ts` | ⬜ |
| ElevenLabs STT API | Whether ElevenLabs offers STT; alternative open STT | `tools/elevenlabs.ts` | ⬜ |
| SerpApi format | Response format for local search queries | `tools/serpapi.ts` | ⬜ |
| Mastra workflow API | Current Mastra API for defining workflows and tools | `workflows/*.ts` | ⬜ |
| Tiger Data / Timescale API | Connection string format, hypertable creation | `db/tiger.ts` | ⬜ |
| MongoDB Atlas Vector Search | Vector index creation syntax, search query format | `db/mongo.ts` | ⬜ |
| Sentry AI tracing | Current API for AI/agent span instrumentation | `telemetry/sentry.ts` | ⬜ |
| Render cron syntax | Cron job configuration in render.yaml | `render.yaml` | ⬜ |
| Entire session capture | API/SDK for capturing agent sessions | `docs/10` | ⬜ |
