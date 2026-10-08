# 08 — Tinker Fine-Tune and Eval

## Overview

The Tinker fine-tune produces a **LoRA adapter** on a small open-weight instruct model to write better, more consistent, more creative outdoor challenges than the same model with prompting alone. This is one of the "open" wins: you own the trained weights and can download them.

**Important:** Tinker does not support Gemma. The base model comes from `TINKER_BASE_MODEL` and must be verified against Tinker's current model list. Default target: a small Qwen instruct model (e.g., Qwen3.5-4B in non-thinking mode). Do NOT use a "Coder" model.

Nothing in the live app depends on the fine-tune succeeding. The tuned writer is behind `USE_TUNED_WRITER=true` with automatic fallback to prompted Gemma.

---

## Pipeline Overview

```
Step 1: Generate Seed Tuples
       │
       ▼
Step 2: Teacher Model Writes Challenges
       │
       ▼
Step 3: Filter (Schema, Dedup, Safety)
       │
       ▼
Step 4: Convert to Tinker Training Format
       │
       ▼
Step 5: LoRA SFT on Tinker
       │
       ▼
Step 6: Holdout Eval (Base Prompted vs. Tuned)
       │
       ▼
Step 7: Report Results
```

---

## Step 1: Generate Seed Tuples (`ml/tinker/generate-dataset.ts`)

Generate several thousand diverse seed tuples from the taxonomy:

```typescript
// Generate ~3000 seed tuples
// Ensure coverage across all categories, place types, constraints, difficulties
// Use combinatorial sampling with controlled randomness
// Split: 2800 training, 200 holdout (never used in training)

interface DatasetSeed {
  tuple: SeedTuple;
  context: {
    weather: string;
    timeOfDay: string;
    city: string;
  };
  split: 'train' | 'holdout';
}
```

Sampling strategy:
- For each of the 11 categories, generate ~270 tuples.
- Within each category, vary place type, constraint, difficulty, and social level.
- Add contextual variation (weather, time of day, city).
- Shuffle and assign 200 to holdout (stratified by category).

---

## Step 2: Teacher Model Writes Challenges

Use an **open-weight teacher model** (hosted, larger than the training target) to generate one challenge per seed tuple.

```typescript
// For each training seed:
// 1. Construct the challenge-writer prompt with the seed tuple and context
// 2. Call the teacher model with JSON schema enforcement
// 3. Parse and store the response

// Teacher model: configurable via TEACHER_MODEL env var
// Default: a larger open-weight model (e.g., Gemma 12B or Qwen 14B)
// MUST be open-weight — no closed models in the pipeline
```

Rate limiting: batch calls with 2-second delays to avoid hitting rate limits.

---

## Step 3: Filter (`ml/tinker/filter.ts`)

Every teacher-generated challenge goes through three filters:

### 3a. Schema Validity
- Parse as JSON
- Validate against the Challenge zod schema
- **Reject** if any required field is missing or invalid

### 3b. Dedup
- Embed each challenge (title + description)
- Remove challenges with cosine similarity > 0.90 to any other in the dataset
- Keep the first one encountered (deterministic)

### 3c. Safety
- Run the code-side safety validator (same one used in production)
- **Reject** any challenge that fails safety rules
- Log rejections with reasons for analysis

### Expected Attrition
- Teacher model JSON validity: ~90-95%
- Dedup removal: ~5-10%
- Safety rejection: ~2-5%
- Final dataset: ~2200-2600 training examples (estimate; actual numbers logged)

---

## Step 4: Convert to Tinker Format

Convert the filtered dataset to the format Tinker expects for LoRA SFT.

```
// TODO(verify): Verify Tinker's exact expected format.
// Likely: JSONL with instruction/input/output fields, or chat format.
// Check Tinker documentation for:
// - Exact JSONL schema
// - Maximum context length
// - Special tokens or formatting
// - Upload method (API or file)
```

Tentative format (to be verified):

```jsonl
{"messages": [{"role": "system", "content": "You are the Touch Grass challenge writer..."}, {"role": "user", "content": "Generate a challenge: category=nature, placeType=park, constraint=barefoot-if-safe, difficulty=2, socialLevel=0, proofType=photo. Context: weather=sunny, timeOfDay=morning, city=Hyderabad"}, {"role": "assistant", "content": "{\"title\": \"...\", ...}"}]}
```

---

## Step 5: LoRA SFT on Tinker (`ml/tinker/train.ts`)

```
// TODO(verify): Verify Tinker API for:
// - Starting a LoRA training job
// - Specifying base model, learning rate, epochs, rank
// - Monitoring training progress
// - Downloading trained weights

// Tentative training config:
// Base model: TINKER_BASE_MODEL (e.g., Qwen3.5-4B-Instruct)
// LoRA rank: 16
// Learning rate: 2e-4
// Epochs: 3
// Max sequence length: 1024
```

### Weight Portability (Key "Open" Claim)

Tinker allows downloading trained LoRA weights. Document the exact export steps:

```
// TODO(verify): Verify exact steps:
// 1. Training completes → Tinker stores the LoRA adapter
// 2. Download endpoint: GET /api/models/{model_id}/weights (or similar)
// 3. Downloaded file: LoRA adapter files (adapter_model.safetensors, adapter_config.json)
// 4. Can be loaded into any compatible framework (transformers, vLLM, Ollama)
// 5. This means: your fine-tune is portable, not locked to Tinker's platform
```

---

## Step 6: Holdout Eval (`ml/tinker/eval.ts`)

Use the 200 holdout seed tuples (never seen during training) to compare:

**(a) Base model prompted:** Same base model (e.g., Qwen3.5-4B-Instruct) with the full system prompt, but NO fine-tuning.

**(b) Tuned model:** The LoRA-adapted model via Tinker sampling API.

### Evaluation Metrics

| Metric | How Measured | Why It Matters |
|---|---|---|
| **JSON validity rate** | `zod.safeParse()` success rate | Tuned model should output valid JSON more reliably |
| **Duplicate rate** | Average pairwise cosine similarity in the 200 outputs | Lower = more diverse challenges |
| **Average embedding distance** | Mean cosine distance from nearest neighbor in training set | Higher = more creative, not just memorizing |
| **Safety-validator pass rate** | Code-side safety validator on all 200 outputs | Must not decrease from base |
| **Average latency** | Mean time per generation (ms) | LoRA should not significantly increase latency |
| **Estimated cost per 1,000** | Based on token usage and endpoint pricing | Tuned model may use fewer tokens (more concise) |

### Side-by-Side Samples

Print 10 side-by-side examples (same seed, base vs. tuned output) for qualitative comparison.

---

## Step 7: Report Results (`ml/tinker/results/eval.md`)

Template:

```markdown
# Tinker Fine-Tune Evaluation Report

## Training Summary
- Base model: [TINKER_BASE_MODEL]
- Training examples: [N after filtering]
- Holdout examples: 200
- LoRA rank: 16
- Epochs: 3
- Training time: [measured]
- Training cost: [if available]

## Results

| Metric | Base (Prompted) | Tuned (LoRA) | Delta |
|---|---|---|---|
| JSON validity rate | X% | Y% | +Z% |
| Duplicate rate (avg sim) | X.XX | Y.YY | ... |
| Avg embedding distance | X.XX | Y.YY | ... |
| Safety pass rate | X% | Y% | ... |
| Avg latency (ms) | X | Y | ... |
| Est. cost per 1,000 | $X.XX | $Y.YY | ... |

## Side-by-Side Samples

### Sample 1
**Seed:** category=nature, placeType=park, constraint=collect-N-items, difficulty=3
**Base output:**
[JSON]
**Tuned output:**
[JSON]

[... 9 more samples ...]

## Analysis
[Honest analysis of results, even if the gain is small or negative]

## Limitations
- [List any issues]
```

> **Honesty rule:** Report real numbers even if the fine-tune doesn't help much. A negative result is still a valid finding for the write-up.

---

## Wiring into Production

### Environment Variables

```bash
USE_TUNED_WRITER=false          # Set to true to use the fine-tuned model
TINKER_API_KEY=                 # Tinker API key
TINKER_BASE_MODEL=              # e.g., "qwen3.5-4b-instruct" (verify against Tinker's list)
```

### Fallback Logic

```typescript
async function generateChallenge(seed: SeedTuple, context: Context): Promise<Challenge> {
  // Try tuned writer first (if enabled and hosted mode)
  if (config.USE_TUNED_WRITER && config.PROVIDER_MODE === 'hosted') {
    try {
      const result = await tinkerProvider.generateChallenge(seed, context);
      if (result) return { ...result, sourceModel: `tinker:${config.TINKER_BASE_MODEL}-lora` };
    } catch (error) {
      Sentry.captureException(error, { tags: { provider: 'tinker' } });
      // Fall through to Gemma
    }
  }

  // Fall back to prompted Gemma
  try {
    const result = await gemmaProvider.generateChallenge(seed, context);
    return { ...result, sourceModel: config.GEMMA_TEXT_MODEL };
  } catch (error) {
    Sentry.captureException(error, { tags: { provider: 'gemma' } });
    // Fall back to backup pool
  }

  // Last resort: backup challenge pool
  return selectBackupChallenge(seed);
}
```

---

## File Structure

```
ml/tinker/
├── generate-dataset.ts      # Step 1-2: Generate seeds + teacher writes challenges
├── filter.ts                 # Step 3: Filter by schema, dedup, safety
├── train.ts                  # Step 4-5: Convert format + start Tinker training
├── eval.ts                   # Step 6-7: Holdout evaluation + report
├── results/
│   ├── eval.md               # Evaluation report (generated)
│   ├── dataset-stats.json    # Dataset statistics (generated)
│   └── samples/              # Side-by-side sample outputs (generated)
├── README.md                 # How to run the pipeline
└── package.json              # Dependencies for the pipeline scripts
```
