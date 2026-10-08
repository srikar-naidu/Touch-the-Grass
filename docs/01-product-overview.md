# 01 — Product Overview

## Vision

**Touch Grass** is a daily real-world challenge agent that generates ONE unique challenge each day, pushing you off your phone and into the world. It verifies your proof, learns what you actually complete, and adapts difficulty over time — all powered by open-source AI.

The app embodies a simple philosophy: **the screen should be the shortest part of the experience.** You open the app, hear your challenge, go do it, snap a photo or tap "done," and put your phone away. Everything else — generation, verification, personalization, reflection — happens in the background.

---

## User Stories

### Core Loop
1. **As a user**, I open the app each morning and hear (audio-first) or read a unique challenge for the day in under 5 seconds.
2. **As a user**, I go outside, complete the challenge, and submit proof (photo, screenshot, voice note, or honor-system confirmation) with minimal screen interaction — ideally one tap plus one photo.
3. **As a user**, I receive a verification verdict (pass/retry/honor) without waiting on-screen; I can pocket my phone and check later.
4. **As a user**, in the evening I optionally record a short voice reflection about my day; the app summarizes my mood and stores it.
5. **As a user**, I see my streak, weekly stats, screen-time-per-day, and a weekly narrative report.

### Personalization
6. **As a user**, I set my city, social-comfort level, and opt-out categories; the app respects these immediately.
7. **As a user**, challenges get harder or easier based on what I actually complete (not just what I say I want).
8. **As a user**, I never get the same challenge twice (or anything too similar).

### Offline / Local
9. **As a user on a trail with no signal**, the app still shows today's challenge (cached), I can capture proof offline, and it syncs when I'm back online.
10. **As a privacy-conscious user**, I can run the entire loop on my laptop with no data leaving my device (`PROVIDER_MODE=local`, `STORE_MODE=local`).

### Meta
11. **As a developer**, I can swap models via environment variables, run the full app in mock mode for development, and deploy to Render with one push.
12. **As an evaluator**, I can see honest benchmarks, field-test logs, and a clear "why open matters" narrative backed by measured data.

---

## Screens

| Screen | Purpose | Target dwell time |
|---|---|---|
| **Today** | Glanceable challenge card + audio play button + badges | < 5 seconds |
| **Prove It** | Camera capture, file upload, Strava screenshot flow, voice note, honor-system confirm | < 30 seconds |
| **Verdict** | Pass / retry / honor result with reason | < 5 seconds |
| **History** | Streak calendar, completion chart, screen-time-per-day, past challenges | Browse at will |
| **Weekly Report** | AI-narrated stats and highlights | 1 minute reading |
| **Settings** | City, social comfort (0–3), opt-out categories, mode info, delete data | One-time setup |

---

## The "Unique Challenge" Philosophy

Every challenge is unique because the system controls the **seed** (a structured tuple of category, place, constraint, difficulty, and proof type) and the LLM only **expands** it into natural language. The seed sampler:

- Draws from a rich taxonomy (~11 categories × ~10 place types × ~10+ constraints × 5 difficulty levels).
- Excludes recently used combinations per user.
- Respects comfort settings (social level, opt-outs).
- Uses embedding similarity to catch near-duplicates even when seeds differ.

The LLM is a writer, not a planner. Planning is in code.

---

## The Screen-Time Principle

**Design rule:** minimize the time the user spends looking at their phone. Measured, not aspirational.

Implementation:
- **Audio-first delivery** via ElevenLabs TTS (or browser `speechSynthesis` fallback). The challenge is spoken aloud; the screen is optional.
- **Pocket mode:** one big "Done" button, optional single photo, optional voice note. No feeds, no infinite scroll, no streak-shaming notifications.
- **Measurement:** Page Visibility API tracks foreground seconds per session and per day. Stored as `screen_seconds` per day and displayed in History. This number goes in the write-up.

---

## Why Open Matters

This project exists *because* open-source AI enables a new kind of app:

1. **Runs on a laptop with no internet.** Local mode uses a single quantized open-weight model (Gemma) via a local runtime (Ollama). The full challenge → verify → reflect loop works offline on an 8 GB machine — no cloud, no API key, no cost.

2. **Your data stays with you.** In local mode, raw photos never leave the device. In hosted mode, images go only to the model provider for verification and are deleted immediately after. The per-mode data-flow table in [docs/09](09-safety-and-privacy.md) is precise about what crosses the wire.

3. **Fine-tune, swap models, change behavior.** One environment variable (`PROVIDER_MODE`) switches between hosted, local, and mock. The Tinker fine-tune produces downloadable LoRA weights you own. The Backboard comparison lets you evaluate any open-weight model. No vendor lock-in.

4. **Costs nothing to run.** Local mode has zero per-token cost. Hosted mode uses open-weight endpoints that are typically cheaper than closed APIs. The cost table in [docs/06](06-models-prompts-and-inference-modes.md) compares prompted, tuned, and local.

5. **The open pieces are what make it work.** Gemma handles vision verification (the hardest task). Mastra orchestrates the agent workflows. The fine-tuned open model writes better challenges than prompted baselines (measured in eval). The entire pipeline is reproducible and auditable.

---

## Non-Goals

- **Not a social network.** No profiles, no feeds, no likes, no comments, no following. You vs. the world, privately.
- **Not a fitness tracker.** We don't replace Strava; we read a screenshot of it. No GPS tracking, no heart rate, no step counting.
- **Not a gamification treadmill.** No XP, no levels, no leaderboards. Streaks are informational, not punitive ("Skip safely" is always available).
- **Not a therapy app.** Mood tracking is lightweight and optional; we make no medical or mental-health claims.
- **Not dependent on any single cloud provider.** Every cloud piece has a local or mock fallback. The app degrades gracefully, never crashes.
- **Not a data collector.** Minimal data, aggressive deletion, city-level location only, anonymous UUID, "Delete my data" button.
