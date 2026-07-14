# AI Analysis Specification — Phase 3

## Document Status
Specification — not yet implemented.

---

## Overview

Phase 3 introduces a new AI task: **Style Profile Generation**. This is a distinct AI call from the existing outfit analysis. It has different inputs, different outputs, different safety constraints, and a different system prompt.

This document also describes how the existing outfit analysis AI call is augmented by the AI Style Profile context.

---

## Task 1 — Style Profile Generation

### Purpose

Extract observable, styling-relevant characteristics from a single user photo and return them as a structured JSON object conforming to the `AIStyleProfile` schema.

---

### Inputs

| Input | Type | Required | Notes |
|---|---|---|---|
| User photo | Image (JPEG/PNG/WEBP) | Yes | Must show the user's face and at least the upper body clearly |
| System prompt | Text | Yes | Loaded from `memory/STYLE_PROFILE_SYSTEM_PROMPT.md` (authored during implementation) |

No garment image. No occasion string. No style preferences. The profile generation call receives only the user photo.

---

### Outputs

The AI returns a JSON object. The application validates it against the `AIStyleProfile` Zod schema.

**On success:** A complete `AIStyleProfile` object (see `05_STYLE_PROFILE_SCHEMA.md`).

**On failure:** An `AIStyleProfileFailure` object with `status: "unable_to_generate"`, `reason`, and `next_step`.

The AI must output one of these two shapes and nothing else. No prose. No commentary outside the JSON object.

---

### What the AI Should Analyze

The following are permitted analytical targets for Style Profile Generation:

| Category | Permitted Analysis |
|---|---|
| **Skin tone** | Depth (light to deep), undertone (cool/warm/neutral) — for color harmony |
| **Hair** | Observable color and color family — for color harmony |
| **Eye color** | Observable eye color — for accent/accessory harmony |
| **Contrast** | Whether the user's coloring is high, medium, or low contrast — for color blocking |
| **Frame width** | Narrow / medium / broad — for garment silhouette recommendations |
| **Torso length** | Short / average / long — for garment length recommendations |
| **Shoulder breadth** | Narrow / medium / broad — for neckline and shoulder style |
| **Current outfit formality** | What level of formality the user is dressed at in the photo |
| **Current outfit style** | Style labels observable from the current outfit (minimalist, classic, etc.) |
| **Accessories** | Whether accessories are minimal, moderate, or statement |
| **Pattern usage** | Whether the user is wearing solid, subtle, bold, or mixed patterns |

All of these serve a single purpose: improving clothing recommendations. The AI must only analyze these categories.

---

### What the AI Must Never Analyze

The following are explicitly prohibited analytical targets:

| Prohibited Category | Reason |
|---|---|
| Attractiveness | Not relevant to clothing; subjective; harmful |
| Beauty score of any kind | Same |
| Facial symmetry | Same |
| Skin clarity, texture, or blemishes | Not relevant to clothing; health inference |
| Weight, BMI, or body mass | Not relevant to clothing; harmful |
| Estimated age | Not relevant to clothing; privacy |
| Health status or health inferences | Outside scope; harmful |
| Emotional state or mood | Outside scope; speculative |
| Ethnic or racial classification | Outside scope; harmful |
| Socioeconomic status | Speculative; harmful |
| Relationship status | Irrelevant |
| Comparisons to other people | Harmful |

If the AI's internal reasoning touches any of these categories to derive a styling recommendation, the AI must not surface that reasoning in the output. The output must contain only the permitted field values.

---

### Confidence

Every section of the AI Style Profile includes a `confidence` field: `"High"`, `"Medium"`, or `"Low"`.

Guidance for when each applies:

| Confidence Level | When to Use |
|---|---|
| High | Observable in the photo with high certainty (clear lighting, visible body area, unambiguous signals) |
| Medium | Observable but with some uncertainty (partial visibility, mixed signals, moderate photo quality) |
| Low | Barely determinable from the photo; the value is a best estimate |

When confidence is `Low` for a section, the AI should prefer `null` values over fabricated ones. A `null` value with a note in `analysis_notes.visibility_limitations` is more honest than a low-confidence guess.

---

### Failure Handling for Profile Generation

The AI should return `status: "unable_to_generate"` when:

1. No person is visible in the photo
2. Multiple people are present and it is ambiguous which to profile
3. The face and upper body are not visible (e.g., full-body photo from very far away, back-of-head only, full-face close-up with no body)
4. Photo quality is so poor (extreme darkness, severe blur) that no reliable observations are possible

The AI should NOT return `unable_to_generate` for:

- Moderate photo quality — low/medium confidence values are appropriate
- Partially visible body (waist-up only) — use `null` for fields requiring full-body visibility
- Unusual or striking style choices — these are interesting data, not failures

The AI should return `"unable_to_generate"` with a `reason` and `next_step` that is specific and actionable. It must not be generic ("analysis failed"). It must name what was missing and what the user should do.

---

### Safety Boundaries for Profile Generation

**Hard boundaries (must never be violated):**

1. The AI must not assign any beauty, attractiveness, or appearance score
2. The AI must not comment on whether the user is attractive, beautiful, or appealing
3. The AI must not infer or mention the user's weight, BMI, or body size using weight-related language
4. The AI must not recommend cosmetic changes, surgery, or body modification
5. The AI must not infer or mention the user's age
6. The AI must not make any comparisons between the user and other people or idealized bodies
7. The output must never contain the words: "attractive", "beautiful", "ugly", "fat", "thin", "overweight", "underweight", "obese", "skinny", "plus-size" (unless directly quoting a user-provided style label)
8. The output field names and values are fixed by the schema — the AI cannot invent new fields

**Design rationale:** These constraints exist because the product's value is clothing decision support, not appearance evaluation. Violating them would cause user harm and destroy product trust. They are non-negotiable and are enforced at three levels: system prompt instruction, schema validation (prohibited fields do not exist in the schema), and test cases.

---

## Task 2 — Outfit Analysis with AI Style Profile (Augmented)

### How the AI Profile Changes Outfit Analysis

The existing outfit analysis call receives the user photo, garment photo, occasion, and manually entered style preferences. Phase 3 adds the AI Style Profile as additional context.

**The analysis output schema is unchanged.** The AI Profile is an input enhancement, not an output addition.

### Additional Context Provided to the AI

When an AI Style Profile is present, the following context is injected into the outfit analysis prompt:

**Coloring context:**
- Skin tone depth and undertone
- Hair color and contrast level

This context improves the `color` dimension evaluation by grounding it in the user's actual coloring rather than relying on observation from the uploaded photo (which may vary in lighting).

**Aesthetic context:**
- Observed style keywords from the profile
- Current outfit formality signal from the profile

This context improves the `style_preference_match` dimension evaluation by providing observed behavior (what the user actually wears) in addition to stated preferences (what the user says they like).

**Proportions context:**
- Frame width, torso length, shoulder breadth

This context is optional enrichment. It may improve the `formality` dimension when garment cut/silhouette is relevant (e.g., oversized vs. tailored).

### Dimensions Improved

| Dimension | How AI Profile Helps |
|---|---|
| `color` | Direct: coloring section provides skin tone and undertone as explicit input |
| `style_preference_match` | Direct: observed style keywords are more reliable than self-reported preferences |
| `formality` | Indirect: proportions context may refine cut/silhouette assessment |
| `occasion` | Minimal improvement |
| `seasonality` | No improvement (seasonal determination is garment + location-based) |

### Confidence

The AI does not report confidence differently based on whether a profile is present. Profile presence is context, not a confidence modifier. The existing confidence reporting rules are unchanged.

---

### What the Augmented Analysis AI Must Never Do

In addition to the existing prohibitions from `SYSTEM_PROMPT.md`, the augmented analysis must not:

1. Reference the user's profile coloring as a compliment or criticism of their appearance
2. Say things like "your warm undertone is beautiful" or "your coloring is unfortunate for this color"
3. Use the profile's proportions data to comment on the user's body
4. Use the profile to draw any conclusions outside clothing recommendations

The profile is silent context. Its influence should be felt in the quality of the recommendation, not surfaced as visible references to the user's appearance.

---

## Reasoning Boundaries

Both AI tasks (profile generation and outfit analysis) must follow these reasoning boundaries:

### Within bounds
- Reasoning about how garment colors interact with visible coloring
- Reasoning about whether garment formality matches the occasion
- Reasoning about whether the garment's style conflicts with the user's observed or stated aesthetic
- Reasoning about whether the garment's proportions (length, cut, silhouette) are appropriate
- Stating what information was and was not available

### Out of bounds
- Reasoning about the user's attractiveness, beauty, or appeal
- Reasoning about the user's weight or body size in any framing
- Reasoning about the user's age, health, or life circumstances
- Reasoning about what would make the user more attractive
- Comparing the user to models, celebrities, or idealized standards

The AI must confine its reasoning to the question: "Does this garment serve this user's styling goals for this occasion?"

---

## Privacy Considerations

### Profile Generation Call
- The user's photo is sent to OpenAI for analysis
- The photo is not stored by the application beyond the request lifetime
- The structured output (not the photo) is stored in `localStorage`
- The system prompt must not instruct the AI to retain information about the user between calls
- The AI's output must not include any information that identifies the user (name, location, etc.)

### Profile Injection into Analysis
- The stored `AIStyleProfile` JSON (not the original photo) is sent in the `/api/analyze` request
- The profile contains only abstract descriptors (e.g., "warm undertone", "medium frame width")
- These descriptors are not personally identifiable on their own
- The analysis result does not reference the profile content back to the user in ways that could be used for identification

### Data Minimization
The `AIStyleProfile` schema is designed to contain the minimum data needed for styling recommendations. Fields with no clear downstream use case are not included. The schema should be reviewed against this principle before each new phase that extends it.

---

## System Prompt Guidance (Non-Prescriptive)

The final system prompt will be authored and validated during implementation. This document provides design guidance only.

### For Profile Generation Prompt
- Specify exactly what to analyze (coloring, proportions, aesthetic signals)
- Explicitly list what must never be analyzed (attractiveness, health, weight, age)
- Specify that `null` is the correct value for fields that cannot be reliably determined
- Specify that the output must be strict JSON conforming to the schema
- Specify that partial JSON is not acceptable — return the full object or the failure object
- Specify the allowed enum values for each field

### For Analysis Prompt (Augmented Section)
- Provide the profile data as labeled context, not as instructions
- Frame it as: "The user's coloring has been analyzed as: [values]. Use this to inform color harmony assessment."
- Do not ask the AI to reference the profile in its output text
- The profile's influence should be silent and factual

---

## Benchmark Integration

### New Benchmark Cases Required (Phase 3)
Phase 3 must add benchmark cases that verify:

1. Color dimension quality improves when accurate coloring context is provided
2. Style preference match quality improves when observed style keywords are provided
3. The AI does not produce beauty-related language in profile output
4. `unable_to_generate` is returned for clearly unsuitable photos (no person, multiple people, too dark)
5. `null` values are used appropriately for unobservable fields

### Existing Benchmark Cases
All 30 existing benchmark cases must continue to pass when the AI profile context is provided (the profile should never make an existing case fail).
