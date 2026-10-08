# 🌿 Touch Grass

**A daily real-world challenge agent powered by open-source AI.**

Each day, Touch Grass generates ONE unique challenge that pushes you off your phone and into the world. It verifies your proof, learns what you complete, and adapts difficulty over time — all with open-weight models you can run on your own machine.

> *"The screen should be the shortest part of the experience."*

---

## Why Open Matters

| Concern | How Open Solves It |
|---|---|
| **Offline / laptop** | Local mode runs a single quantized Gemma via Ollama. Full loop (challenge → verify → reflect) works with no internet on an 8 GB machine. |
| **Your data stays with you** | In local mode, raw photos never leave the device. No tracking, no analytics you can't see. |
| **Fine-tune & swap models** | One env var (`PROVIDER_MODE`) switches the entire stack. Tinker fine-tune produces downloadable LoRA weights you own. |
| **Costs nothing to run** | Local mode = $0 per-token cost. Hosted mode uses cheaper open-weight endpoints. |
| **Transparent & auditable** | Every prompt, schema, and safety rule is in the codebase. MIT licensed. |

---

## Architecture Summary

```
React PWA (mobile-first, offline-capable)
    ↕
Hono API Server + Mastra Agent Workflows
    ↕
┌─────────────────────────────────────────────┐
│ ModelProvider (hosted | local | mock)        │
│ Repository (MongoDB+Tiger | SQLite | memory) │
│ Adapters (SerpApi, ElevenLabs, TabPFN, ...)  │
└─────────────────────────────────────────────┘
```

- **Orchestration:** Mastra (open-source agent framework, MIT)
- **Primary model:** Gemma (open-weight, vision-capable) — runs hosted or locally via Ollama
- **Fine-tuned writer:** Small Qwen instruct via Tinker LoRA (optional, hosted only)
- **Scoring:** TabPFN (tabular prediction for difficulty targeting) with heuristic fallback
- **Storage:** MongoDB Atlas + Tiger Data (hosted) or SQLite (local)
- **Observability:** Sentry with AI/agent tracing
- **Voice:** ElevenLabs TTS/STT with browser `speechSynthesis` fallback

---

## Prerequisites

- **Node.js 20+** and **npm**
- **Python 3.11+** (for TabPFN service)
- **Git**

### For hosted mode:
- API keys for: Gemma endpoint, MongoDB Atlas, and optionally: Tinker, ElevenLabs, SerpApi, Tiger Data, Sentry, Backboard, TabPFN

### For local mode:
- [Ollama](https://ollama.ai) installed with a Gemma model pulled (e.g., `ollama pull gemma3:4b`)
- No API keys needed (everything runs locally)

---

## Quick Start

### 1. Clone and install

```bash
git clone https://github.com/YOUR_USERNAME/touch-grass.git
cd touch-grass
npm install
cd services/tabpfn && pip install -r requirements.txt && cd ../..
```

### 2. Configure

```bash
cp .env.example .env
# Edit .env with your settings (see Environment Variables below)
```

### 3. Run in Mock Mode (no keys needed)

```bash
# Set in .env:
# PROVIDER_MODE=mock
# STORE_MODE=mock

npm run dev
# API: http://localhost:3000
# PWA: http://localhost:5173

# Trigger a mock challenge:
curl -X POST http://localhost:3000/dev/run-daily -H "Content-Type: application/json" -d '{"userId":"test"}'
```

### 4. Run in Hosted Mode

```bash
# Set in .env:
# PROVIDER_MODE=hosted
# STORE_MODE=hosted
# Fill in API keys (see .env.example)

npm run dev
```

### 5. Run in Local Mode

```bash
# Start Ollama with a Gemma model:
ollama serve
ollama pull gemma3:4b

# Set in .env:
# PROVIDER_MODE=local
# LOCAL_BASE_URL=http://localhost:11434
# LOCAL_MODEL=gemma3:4b

npm run dev
```

---

## Environment Variables

| Variable | Required | Default | Description |
|---|---|---|---|
| `PROVIDER_MODE` | Yes | `mock` | `hosted`, `local`, or `mock` |
| `STORE_MODE` | No | `hosted` | `hosted`, `mongo-only`, `local`, or `mock` |
| `GEMMA_BASE_URL` | Hosted | — | Gemma API endpoint URL |
| `GEMMA_API_KEY` | Hosted | — | Gemma API key |
| `GEMMA_VISION_MODEL` | Hosted | — | Gemma vision model ID |
| `GEMMA_TEXT_MODEL` | Hosted | — | Gemma text model ID |
| `LOCAL_BASE_URL` | Local | `http://localhost:11434` | Ollama or llama.cpp URL |
| `LOCAL_MODEL` | Local | `gemma3:4b` | Local model name |
| `EMBEDDING_BASE_URL` | Hosted | — | Embedding model endpoint |
| `EMBEDDING_API_KEY` | Hosted | — | Embedding API key |
| `EMBEDDING_MODEL` | Hosted | — | Embedding model ID |
| `USE_TUNED_WRITER` | No | `false` | Enable Tinker fine-tuned writer |
| `TINKER_API_KEY` | If tuned | — | Tinker API key |
| `TINKER_BASE_MODEL` | If tuned | — | Tinker base model ID |
| `TABPFN_TOKEN` | No | — | TabPFN API token |
| `TABPFN_SERVICE_URL` | No | — | TabPFN service URL |
| `BACKBOARD_API_KEY` | No | — | Backboard API key |
| `ELEVENLABS_API_KEY` | No | — | ElevenLabs API key |
| `SERPAPI_API_KEY` | No | — | SerpApi API key |
| `MONGODB_URI` | Hosted | — | MongoDB Atlas connection string |
| `TIGER_DATABASE_URL` | No | — | Tiger Data / TimescaleDB URL |
| `SENTRY_DSN` | No | — | Sentry DSN |
| `SENTRY_ENVIRONMENT` | No | `development` | Sentry environment tag |
| `APP_BASE_URL` | No | `http://localhost:3000` | Public app URL |
| `DEFAULT_CITY` | No | `Hyderabad, India` | Default city for grounding |
| `DIFFICULTY_TARGET_MIN` | No | `0.6` | TabPFN target probability min |
| `DIFFICULTY_TARGET_MAX` | No | `0.7` | TabPFN target probability max |

---

## Scripts

| Script | Description |
|---|---|
| `npm run dev` | Start API + PWA in development mode |
| `npm run build` | Build for production |
| `npm run start` | Start production server |
| `npm run test` | Run all unit tests (Vitest) |
| `npm run lint` | Lint TypeScript |
| `npm run typecheck` | Type-check TypeScript |
| `npm run cron:daily` | Run the daily challenge cron job |

### ML Scripts

| Script | Description |
|---|---|
| `npx tsx ml/tinker/generate-dataset.ts` | Generate training dataset |
| `npx tsx ml/tinker/filter.ts` | Filter dataset |
| `npx tsx ml/tinker/train.ts` | Start Tinker training |
| `npx tsx ml/tinker/eval.ts` | Run holdout evaluation |
| `npx tsx ml/backboard/compare.ts` | Multi-model comparison |
| `npx tsx ml/local-bench/bench.ts` | Local mode benchmark |
| `npx tsx ml/synthetic/generate-users.ts` | Generate synthetic user data |

---

## Repository Layout

```
/
├── README.md                    ← You are here
├── LICENSE                      (MIT)
├── render.yaml                  (Render Blueprint)
├── .env.example                 (All env vars with comments)
├── package.json
├── docs/                        (10 design documents — source of truth)
│   ├── 01-product-overview.md
│   ├── 02-architecture.md
│   ├── 03-sponsor-integrations-and-writeup.md
│   ├── 04-data-models.md
│   ├── 05-agent-workflows.md
│   ├── 06-models-prompts-and-inference-modes.md
│   ├── 07-personalization-and-taxonomy.md
│   ├── 08-tinker-finetune-and-eval.md
│   ├── 09-safety-and-privacy.md
│   └── 10-testing-deployment-observability.md
├── apps/
│   ├── web/                     (React + Vite PWA)
│   └── api/                     (Hono + Mastra API server)
├── services/
│   └── tabpfn/                  (FastAPI Python service)
├── ml/
│   ├── tinker/                  (Fine-tune pipeline)
│   ├── backboard/               (Multi-model comparison)
│   ├── local-bench/             (Local mode benchmark)
│   └── synthetic/               (Synthetic user data generator)
├── fixtures/                    (Test photos, screenshots, canned responses)
└── .github/                     (CI, Copilot instructions, PR template)
```

---

## Docs Index

| # | Document | Description |
|---|---|---|
| 01 | [Product Overview](docs/01-product-overview.md) | Vision, user stories, screens, philosophy |
| 02 | [Architecture](docs/02-architecture.md) | Components, data flow, three runtime modes |
| 03 | [Sponsor Integrations & Write-Up](docs/03-sponsor-integrations-and-writeup.md) | Per-sponsor evidence, write-up outline, field-test plan |
| 04 | [Data Models](docs/04-data-models.md) | MongoDB, Tiger Data, SQLite schemas |
| 05 | [Agent Workflows](docs/05-agent-workflows.md) | Mastra workflows step by step |
| 06 | [Models, Prompts & Inference](docs/06-models-prompts-and-inference-modes.md) | Models, prompts, schemas, retry rules, benchmark |
| 07 | [Personalization & Taxonomy](docs/07-personalization-and-taxonomy.md) | Seed taxonomy, scoring, dedup, difficulty targeting |
| 08 | [Tinker Fine-Tune & Eval](docs/08-tinker-finetune-and-eval.md) | Dataset, training, evaluation, portability |
| 09 | [Safety & Privacy](docs/09-safety-and-privacy.md) | Safety rules, data-flow tables, deletion |
| 10 | [Testing, Deploy & Observability](docs/10-testing-deployment-observability.md) | Mock mode, CI, Render, Sentry |

---

## License

[MIT](LICENSE) — Open source, open weights, open data. Use it, fork it, improve it.

---

## Changelog

- **2026-10-08:** Initial documentation (Step Zero). All 10 docs, README, LICENSE created.
