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
