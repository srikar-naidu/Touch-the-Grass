# 07 — Personalization and Taxonomy

## Seed Taxonomy

The taxonomy is the backbone of challenge uniqueness. The LLM is a writer, not a planner — the code picks the seed, and the model only expands it into natural language.

### Categories

| Category | Description | Example |
|---|---|---|
| `nature` | Interact with natural elements — plants, trees, soil, water, sky | Touch grass, photograph bark textures, find 5 different flowers |
| `movement` | Physical movement — walking, running, stretching, dancing | Run for 10 minutes, do 20 jumping jacks in a park, dance in the rain |
| `sport` | Play or practice a sport | Play table tennis, shoot hoops, kick a football |
| `social-light` | Low-stakes social interaction (no strangers, or very light) | Wave at a neighbor, call a friend while walking, sit in a café and people-watch |
| `social-bold` | Higher-stakes social interaction (requires approaching someone) | Pay a genuine compliment to a stranger about their outfit, ask someone for directions you don't need |
| `creative` | Create something outdoors | Draw a leaf, write a haiku about what you see, build a small cairn |
| `mindful` | Mindfulness, meditation, or sensory awareness | Sit under a tree for 5 minutes with eyes closed, count 10 different sounds outdoors |
| `sensory` | Engage specific senses | Feel 5 different textures, identify 3 smells, listen to birdsong for 2 minutes |
| `style` | Fashion / outfit / fit-check challenges | Do a fit check on a basketball court, photograph your shadow, style an outfit with one natural element |
| `community` | Give back to your community | Pick up 5 pieces of litter, water a public plant, leave a kind note on a bench |
| `exploration` | Discover new places or routes | Walk down a street you've never been on, find a hidden courtyard, take 3 photos of street art |

### Place Types

| Place Type | Description |
|---|---|
| `park` | Public park, garden, green space |
| `court` | Basketball court, tennis court, badminton court |
| `street` | Any public street, sidewalk, or pedestrian area |
| `market` | Outdoor market, bazaar, shopping street |
| `rooftop` | Rooftop, terrace, balcony with a view |
| `trail` | Hiking trail, walking path, nature trail |
| `water-edge` | Lake shore, river bank, beach, fountain |
| `neighborhood` | Your immediate neighborhood, within walking distance |
| `campus` | University campus, office campus, institutional grounds |
| `any` | No specific place requirement |

### Constraints

| Constraint | Description | Difficulty Modifier |
|---|---|---|
| `no-phone-N` | Put your phone away for N minutes (N varies) | +1 |
| `with-a-friend` | Do it with someone | +1 (social) |
| `barefoot-if-safe` | Go barefoot on grass or sand (if safe) | +1 |
| `collect-N-items` | Collect or photograph N different items | +0-1 |
| `timed` | Complete within a time limit | +1 |
| `silent` | Do it without speaking | +0 |
| `golden-hour` | Do it during golden hour (near sunset/sunrise) | +1 (scheduling) |
| `eyes-closed-N` | Close your eyes for N seconds as part of the challenge | +0 |
| `one-handed` | Use only one hand (creative/fun constraint) | +0 |
| `backwards` | Walk backwards, or reverse your usual route | +0 |
| `none` | No special constraint | +0 |

### Proof Types

| Proof Type | Verification Method | When to Use |
|---|---|---|
| `photo` | Gemma vision against proof_rubric | Most challenges — nature, creative, sport, style |
| `strava_screenshot` | Gemma vision extraction + code validation | Movement challenges (running, walking, cycling) |
| `voice_note` | Honor system + reflection | Mindful, sensory challenges |
| `honor` | User self-report | Social challenges, no-phone challenges |

### Difficulty Scale

| Level | Label | Description | Estimated Time |
|---|---|---|---|
| 1 | **Doorstep** | Can be done from your doorstep or balcony | 2-5 min |
| 2 | **Easy walk** | Short walk, minimal effort | 5-15 min |
| 3 | **Standard** | Requires going somewhere specific, moderate effort | 15-30 min |
| 4 | **Committed** | Significant time or effort, may need planning | 30-60 min |
| 5 | **Adventure** | Extended outing, physical challenge, or social boldness | 60-120 min |

### Social Level

| Level | Label | Description |
|---|---|---|
| 0 | **Solo** | No social interaction required |
| 1 | **Passive** | Being around people but not interacting (e.g., sit in a café) |
| 2 | **Light** | Brief, low-stakes interaction (wave, brief chat) |
| 3 | **Bold** | Approaching someone, extended interaction, or public performance |

---

## Seed Tuple

```typescript
interface SeedTuple {
  category: Category;
  placeType: PlaceType;
  constraint: Constraint;
  difficulty: number;        // 1-5
  socialLevel: number;       // 0-3
  proofType: ProofType;
  estimatedMinutes: number;  // derived from difficulty
}
```

---

## Uniqueness / Dedup Strategy

### Layer 1: Seed-Level Dedup (Fast, Exact)

Before sending to the LLM, the sampler checks if the same `(category, placeType, constraint)` tuple was used in the user's last 14 days. If so, the tuple is excluded.

This is a database query, not an LLM call. It's fast and deterministic.

### Layer 2: Tag Overlap (Fast, Approximate)

After generation, check if the new challenge's tags overlap >70% with any challenge from the last 30 days. If so, regenerate.

### Layer 3: Embedding Similarity (Atlas Vector Search)

After generation, embed the full challenge text (title + description) using the embedding model. Query Atlas Vector Search for the user's past challenges with cosine similarity > 0.85.

If a near-duplicate is found, regenerate with a different seed (up to 3 attempts).

### Dedup Budget

- Max 3 regeneration attempts per daily challenge
- After 3 failures, accept the challenge with a `similar_to` flag
- Log all dedup events for analysis

---

## TabPFN Usage

### What TabPFN Does

TabPFN is a tabular prediction model. It takes structured features (not text) and predicts a binary outcome (challenge completed vs. not completed).

### Input Features

For each candidate seed, construct a feature row:

| Feature | Type | Source |
|---|---|---|
| `category_encoded` | int | Seed tuple (one-hot or ordinal encoding) |
| `difficulty` | int (1-5) | Seed tuple |
| `social_level` | int (0-3) | Seed tuple |
| `hour_of_day` | int (0-23) | Current time in user's timezone |
| `day_of_week` | int (0-6) | Current date |
| `weather_encoded` | int | Context (sunny=0, cloudy=1, rainy=2, etc.) |
| `streak_days` | int | User's current streak |
| `recent_skips` | int | Number of skips in last 7 days |
| `category_completion_rate` | float (0-1) | User's historical completion rate for this category |
| `avg_difficulty_completed` | float | Average difficulty of completed challenges |
| `days_since_last_activity` | int | Days since user last completed a challenge |

### Training Data

TabPFN is a few-shot tabular predictor — it doesn't need traditional training. It uses the user's historical event data as its training context:

```python
# Pseudo-code for TabPFN scoring
from tabpfn import TabPFNClassifier

# User's history as training data
X_train = user_history_features  # shape: (n_past_challenges, n_features)
y_train = user_history_outcomes  # shape: (n_past_challenges,), 0 or 1

# Candidate seeds as test data
X_test = candidate_features     # shape: (n_candidates, n_features)

clf = TabPFNClassifier()
clf.fit(X_train, y_train)
probabilities = clf.predict_proba(X_test)[:, 1]  # completion probability
```

### Selection Strategy

1. Score all ~20 candidates.
2. Select the candidate with completion probability closest to the **target range** (default 0.6–0.7).
3. If no candidate is in range, pick the closest one.
4. If the user has fewer than 5 history entries, use rule-based selection instead (see below).

### Why 0.6–0.7?

- Too easy (>0.8): boring, no growth.
- Too hard (<0.4): discouraging, likely to skip.
- The sweet spot (0.6–0.7): challenging but achievable, promotes engagement and growth.
- This target is configurable via `DIFFICULTY_TARGET_MIN` and `DIFFICULTY_TARGET_MAX`.

---

## Heuristic Offline Scorer (Fallback)

When TabPFN is unavailable (local mode, network failure, cold start), use a simple heuristic:

```typescript
function heuristicScore(
  seed: SeedTuple,
  history: UserHistory
): number {
  let score = 0.5; // base probability

  // Difficulty adjustment: harder = lower probability
  score -= (seed.difficulty - 3) * 0.1;

  // Social adjustment: higher social = lower probability for low-comfort users
  score -= Math.max(0, seed.socialLevel - history.socialComfort) * 0.15;

  // Streak bonus: active users are more likely to complete
  score += Math.min(history.streakDays * 0.02, 0.1);

  // Category affinity: higher completion rate in this category = higher probability
  const categoryRate = history.categoryCompletionRates[seed.category] ?? 0.5;
  score += (categoryRate - 0.5) * 0.2;

  // Recent skip penalty: many recent skips = lower probability
  score -= history.recentSkips * 0.03;

  // Clamp to [0.1, 0.95]
  return Math.max(0.1, Math.min(0.95, score));
}
```

This is a plain TypeScript function with no model download. It won't be as accurate as TabPFN but provides reasonable personalization.

---

## Synthetic Cold-Start Data

### Purpose

New users have no history. TabPFN needs training data. We generate synthetic users to:
1. Test the full pipeline end-to-end.
2. Provide cold-start training data for TabPFN (clearly labeled).
3. Validate the heuristic scorer against TabPFN.

### Generation (`ml/synthetic/generate-users.ts`)

Generate ~30 synthetic users with diverse profiles:

| User Archetype | City | Social Comfort | Typical Difficulty | Completion Pattern |
|---|---|---|---|---|
| Active Adventurer | Hyderabad | 3 | 4-5 | 80% completion, prefers sport/exploration |
| Gentle Introvert | Bangalore | 0 | 1-2 | 60% completion, prefers nature/mindful |
| Social Butterfly | Mumbai | 3 | 2-3 | 70% completion, prefers social-light/community |
| Weekend Warrior | Delhi | 1 | 3-4 | 40% weekday, 90% weekend |
| Sporadic User | Chennai | 1 | 2-3 | 30% completion, long gaps between activities |
| ... (25 more variations) | ... | ... | ... | ... |

Each synthetic user has 30-90 days of simulated history with realistic patterns.

### Labeling

**All synthetic data is labeled:**
- `synthetic: true` field on every record
- Synthetic user IDs prefixed with `syn-`
- README and docs note the presence of synthetic data
- Never presented as real usage in the write-up

### Difficulty Targeting

For new real users (fewer than 5 events):
1. Start with difficulty 2, social level ≤ user's comfort setting.
2. Use rule-based seed selection (random from filtered pool).
3. After 5 events, switch to TabPFN/heuristic scoring.
4. Gradually increase difficulty if completion rate is high; decrease if skips pile up.

The ramp is conservative:
- After 3 consecutive completions at difficulty N: offer N+1 next time.
- After 2 consecutive skips: drop difficulty by 1 and reduce social level.
- Never jump more than 1 difficulty level between days.
