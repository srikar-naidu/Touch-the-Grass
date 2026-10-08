# 09 — Safety and Privacy

## Hard Safety Rules (Enforced in Code)

These rules are enforced by a **code-side validator** (blocklist + structural checks). The validator runs on every generated challenge BEFORE it reaches the user. A model-based safety check runs in addition, but the code validator is the hard gate.

### Code-Side Validator Rules

A challenge is **REJECTED** if ANY of these rules fail:

#### 1. No Trespassing / No Illegal Activity
- Blocklist keywords: `trespass`, `break in`, `sneak`, `restricted`, `private property`, `fence`, `locked`, `unauthorized`
- No suggestion to enter buildings, compounds, or areas without explicit public access
- No suggestion of illegal activities of any kind

#### 2. No Dangerous Activities
- Blocklist: `cliff`, `rooftop edge`, `highway`, `traffic`, `swim in`, `dive`, `jump from`, `fire`, `flame`, `torch`, `lightning`, `flood`, `storm`, `blizzard`, `stunt`, `parkour`
- No challenges involving heights above ground level (rooftop OK for viewing, not for climbing edges)
- No water activities beyond the water's edge (wading OK, swimming not)
- No challenges in active traffic areas
- No fire-related activities

#### 3. No Night-Alone Challenges
- If the challenge involves being outdoors after sunset (based on city + date), reject it
- Exception: challenges that can be done on a well-lit street, balcony, or near home
- Sunset time is derived from city + SerpApi context, or use conservative default (6:00 PM)

#### 4. No Minors / No Non-Consensual Photography
- Blocklist: `child`, `kid`, `minor`, `school`, `playground` (for approaching/interacting; observing a park is OK)
- No challenges that require photographing identifiable strangers
- No challenges that require recording strangers (audio or video)

#### 5. Social Challenge Rules
- All social challenges MUST:
  - Be consent-first (the description must include "ask first" or "only if they're open to it" or equivalent)
  - Be kind and positive (compliments, help, gratitude — never criticism, pranks, or confrontation)
  - Be easy to decline (the other person can say no, and that's fine)
  - Have "Skip safely" available (never penalize skipping a social challenge)
- Blocklist for social: `confront`, `argue`, `debate`, `prank`, `scare`, `romantic`, `flirt`, `ask for number`, `personal information`, `follow`
- Never require sharing personal information with strangers

#### 6. No Substances / No Required Spending
- Blocklist: `alcohol`, `drink`, `beer`, `wine`, `bar`, `drug`, `smoke`, `vape`, `buy`, `purchase`, `spend`, `pay for` (exception: "pay a compliment" which is idiomatic)
- Exception for "pay a compliment" — detected by pattern match, not blocklist

#### 7. No Medical Claims
- Blocklist: `therapy`, `cure`, `heal`, `treatment`, `diagnosis`, `mental health benefit`, `anxiety cure`, `depression treatment`
- Mood tracking is OK; health claims are not

#### 8. Physical Safety Note Required
- Any challenge with difficulty ≥ 3 or involving movement/sport must include a `safetyNotes` field
- The safety note must mention an easy alternative or "go at your own pace"
- If `safetyNotes` is null for a physical challenge, the validator adds a generic one

### Validator Implementation

```typescript
interface SafetyResult {
  safe: boolean;
  violations: string[];
  autoFixed: boolean;    // true if safety notes were auto-added
}

function validateChallengeSafety(
  challenge: Challenge,
  context: { sunsetTime?: string; timeOfDay?: string }
): SafetyResult {
  const violations: string[] = [];

  // Run all rule checks...
  // Each check adds to violations[] if failed

  return {
    safe: violations.length === 0,
    violations,
    autoFixed: false,
  };
}
```

### Model-Based Safety Check (Secondary)

After the code validator passes, the challenge is also sent to Gemma with the safety classifier prompt (see docs/06). If the model flags it as unsafe, the challenge is rejected. **Both** checks must pass.

---

## Social Challenge Rules (Expanded)

Social challenges are the highest-risk category. Extra rules:

| Rule | Implementation |
|---|---|
| **Consent-first language** | Prompt instructs "always include consent language." Validator checks for presence of consent keywords: `ask`, `permission`, `only if`, `open to`, `willing`. |
| **Kind and positive** | Blocklist for negative social actions. Prompt emphasizes kindness. |
| **Easy to decline** | Validator checks for decline language: `it's ok`, `no pressure`, `skip`, `that's fine`. |
| **No strangers required (social-light)** | Social-light challenges should not require cold-approaching strangers. Validator rejects if social_level=1 but description mentions strangers. |
| **Skip safely always available** | The UI always shows "Skip safely" for social challenges (social_level ≥ 2). |
| **Never verify social interactions with photos** | If proof_type is set to `photo` on a social challenge (social_level ≥ 2), the validator changes it to `honor`. |
| **No power imbalances** | Blocklist: `employee`, `server`, `waitress`, `cashier`, `worker` in contexts that imply obligatory interaction. |

---

## Per-Mode Data-Flow Table

> This table is precise about what crosses the network in each mode. Use it in the write-up.

### Hosted Mode (`PROVIDER_MODE=hosted`, `STORE_MODE=hosted`)

| Data | Destination | Purpose | Retention |
|---|---|---|---|
| Challenge text (prompt) | Gemma endpoint | Generate challenge | Transient (API call) |
| Challenge text (output) | MongoDB Atlas | Store challenge | 90 days |
| Photo (base64, resized, EXIF-stripped) | Gemma endpoint | Vision verification | Transient (API call only, NOT stored by us) |
| Strava screenshot (same) | Gemma endpoint | Data extraction | Transient |
| Verification verdict | MongoDB Atlas | Store result | 90 days |
| Voice note (base64) | ElevenLabs STT | Transcription | Transient (deleted after) |
| Reflection transcript | MongoDB Atlas | Store summary | 90 days |
| City name (coarse) | SerpApi | Location grounding | Transient |
| Event metadata | Tiger Data | Analytics | 1 year |
| Sentry trace data | Sentry | Observability | Per Sentry retention |
| **NOT sent:** raw photos (deleted after verification), precise GPS (not collected), user identity (anonymous UUID), audio files (deleted after STT) |

### Local Mode (`PROVIDER_MODE=local`, `STORE_MODE=local`)

| Data | Destination | Purpose | Retention |
|---|---|---|---|
| Challenge text (prompt) | Localhost (Ollama) | Generate challenge | Transient |
| Photo (base64, resized) | Localhost (Ollama) | Vision verification | Transient |
| All challenge data | Local SQLite | Storage | Until user deletes |
| TTS audio | Browser (on-device) | Audio playback | Transient |
| **Nothing leaves the device.** No cloud calls, no API calls, no network traffic. |

### Mock Mode (`PROVIDER_MODE=mock`)

| Data | Destination | Purpose |
|---|---|---|
| Nothing | Nowhere | All data is canned fixtures |

---

## Image / Audio / Screenshot Handling

### Photos

1. **Client-side:** Resize to max `1024px` (hosted) or `512px` (local) longest edge. Strip all EXIF metadata (including GPS). Convert to JPEG at 80% quality.
2. **Upload:** Send base64-encoded image to the API.
3. **Verification:** API sends image to Gemma vision (hosted endpoint or localhost).
4. **Storage:** After verification, the raw image is **deleted**. Only the verdict (pass/confidence/reason) is stored.
5. **Optional thumbnail:** If user opts in (settings), a 64px thumbnail is stored for the History view. Off by default.

### Strava Screenshots

Same pipeline as photos. The extracted fields (activity_type, distance, duration, date) are stored; the screenshot is deleted.

### Audio (Voice Notes)

1. **Client-side:** Record via MediaRecorder API. Format: webm/opus or mp3.
2. **Upload:** Send base64-encoded audio to the API.
3. **Transcription:** API sends to ElevenLabs STT (or skips if unavailable).
4. **Storage:** After transcription, the raw audio is **deleted**. Only the text transcript and mood summary are stored.
5. **Local mode:** Audio is never sent anywhere. Text input only.

---

## "Delete My Data" Endpoint

```
DELETE /api/users/:userId/data
```

Behavior:
1. Delete all challenges for this userId from MongoDB/SQLite.
2. Delete all events for this userId from Tiger Data/SQLite.
3. Delete the user profile.
4. Confirm: `{ deleted: true, collections: ['challenges', 'events', 'users'] }`.
5. Log a deletion event (with no PII, just a timestamp and "user-deleted" flag) for audit.

UI: Settings → "Delete My Data" button with confirmation dialog.

In local mode: `DELETE FROM challenges WHERE user_id = ?`, etc., then `VACUUM`.

---

## What We Never Log

| Never Logged | Why |
|---|---|
| Raw image data | Privacy; deleted after verification |
| Raw audio data | Privacy; deleted after transcription |
| GPS coordinates | Not collected; city-level only |
| API keys or tokens | Security |
| Full model prompts with user data | Privacy; log prompt template name only |
| User-identifiable information | Anonymous UUID only |
| Sentry breadcrumbs with media | Sentry captures errors with context, never images/audio |

---

## Content Moderation

The system generates challenges, not user-generated content. The safety validator is the content moderation layer. There is no user-to-user interaction, no comments, no sharing, so traditional content moderation is not needed.

If the proof photo contains inappropriate content, Gemma vision will flag it as not matching the rubric. The system does not store or analyze the content of photos beyond rubric matching.
