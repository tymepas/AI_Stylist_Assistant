# AI Style Profile Schema — Phase 3

## Document Status
Specification — not yet implemented.

---

## Design Principles

1. **Only styling-relevant fields.** Every field must demonstrably improve outfit recommendations, shopping recommendations, or wardrobe cohesion analysis. If a field has no clear connection to clothing decisions, it is excluded.

2. **No beauty, health, or appearance scoring.** Fields describing attractiveness, skin clarity, weight, BMI, age estimates, or health status are explicitly prohibited. Any field that could be interpreted as a beauty or health score is excluded.

3. **Observable facts only.** Fields describe what can be directly observed in a photo: colors, proportions relevant to fit, visible aesthetic signals. They do not infer personality, lifestyle, social status, or character.

4. **Forward compatible.** The schema is designed to serve Phase 3 (Shopping), Phase 4 (Wardrobe Memory), and Phase 5 (Virtual Try-On) without requiring a breaking change. Fields not needed until later phases are included with nullable/optional status.

5. **Atomic generation.** The schema is generated as a whole from a single AI call. There are no partial profiles. A profile either exists in full or does not exist.

6. **Confidence-aware.** Fields the AI cannot determine from a given photo use `null` rather than fabricated values. Confidence levels accompany multi-value fields where the AI's certainty varies.

---

## Schema

### Root Object: `AIStyleProfile`

```json
{
  "schema_version": "1.0",
  "generated_at_utc": "<ISO 8601 timestamp>",
  "status": "complete",
  "coloring": { ... },
  "proportions": { ... },
  "aesthetic_signals": { ... },
  "style_keywords": [ ... ],
  "wardrobe_context": { ... },
  "analysis_notes": { ... }
}
```

---

### Field: `schema_version`

| Property | Value |
|---|---|
| Type | `string` |
| Required | Yes |
| Allowed values | `"1.0"` (will increment with breaking changes) |
| Purpose | Enables forward-compatible migration of stored profiles |
| Future usage | Version gate in storage service to trigger re-generation on schema mismatch |

---

### Field: `generated_at_utc`

| Property | Value |
|---|---|
| Type | `string` (ISO 8601, e.g. `"2025-01-15T14:32:00Z"`) |
| Required | Yes |
| Set by | Application (not AI) — appended after successful generation |
| Purpose | Timestamp for display ("generated on...") and future staleness detection |
| Future usage | Phase 4 may prompt re-generation if profile is older than a threshold |

---

### Field: `status`

| Property | Value |
|---|---|
| Type | `string` enum |
| Required | Yes |
| Allowed values | `"complete"` \| `"unable_to_generate"` |
| Purpose | Discriminator; if `"unable_to_generate"`, only `status`, `schema_version`, and `reason` are present |
| Future usage | Stable |

---

### Section: `coloring`

Describes the user's observable color characteristics. Used by the AI to evaluate color harmony between garments and the user's natural coloring. Used by Phase 3 shopping to filter recommendations by flattering color families.

```json
"coloring": {
  "skin_tone_depth": "medium",
  "skin_tone_undertone": "warm",
  "hair_color": "dark brown",
  "hair_color_family": "dark",
  "eye_color": "brown",
  "high_contrast": true,
  "confidence": "High"
}
```

#### `coloring.skin_tone_depth`

| Property | Value |
|---|---|
| Type | `string` enum \| `null` |
| Required | Yes (nullable) |
| Allowed values | `"very light"` \| `"light"` \| `"medium light"` \| `"medium"` \| `"medium deep"` \| `"deep"` \| `null` |
| Purpose | Informs color harmony evaluation; some palettes work better at certain depth levels |
| Future usage | Shopping color filter: recommend palettes known to work at this depth |
| AI constraint | Descriptive only; must never be used as a basis for comparison between users |

#### `coloring.skin_tone_undertone`

| Property | Value |
|---|---|
| Type | `string` enum \| `null` |
| Required | Yes (nullable) |
| Allowed values | `"cool"` \| `"warm"` \| `"neutral"` \| `null` |
| Purpose | Fundamental color theory input; warm undertones suit different palettes than cool undertones |
| Future usage | Shopping: filter by garment colors known to complement the undertone |
| Note | Use `null` if insufficient photo quality to determine reliably |

#### `coloring.hair_color`

| Property | Value |
|---|---|
| Type | `string` \| `null` |
| Required | Yes (nullable) |
| Allowed values | Free-form short description (e.g., `"dark brown"`, `"platinum blonde"`, `"auburn"`) |
| Max length | 40 characters |
| Purpose | Color harmony context — the user's hair color affects how garment colors read |
| Future usage | Wardrobe memory: note which garment colors clash with hair color |

#### `coloring.hair_color_family`

| Property | Value |
|---|---|
| Type | `string` enum \| `null` |
| Required | Yes (nullable) |
| Allowed values | `"light"` \| `"medium"` \| `"dark"` \| `"vivid"` \| `null` |
| Purpose | Normalized bucket for programmatic use (e.g., in shopping filters) |
| Future usage | Shopping: structured filter by hair color family |

#### `coloring.eye_color`

| Property | Value |
|---|---|
| Type | `string` \| `null` |
| Required | Yes (nullable) |
| Allowed values | Free-form short description (e.g., `"brown"`, `"blue-green"`, `"hazel"`) |
| Max length | 30 characters |
| Purpose | Secondary color input; eye color can inform accent and accessory recommendations |
| Future usage | Shopping: accessories and accent colors |

#### `coloring.high_contrast`

| Property | Value |
|---|---|
| Type | `boolean` \| `null` |
| Required | Yes (nullable) |
| Purpose | High contrast coloring (e.g., very dark hair + very light skin) responds differently to color blocking and patterns |
| Future usage | Shopping: pattern and color blocking recommendations |

#### `coloring.confidence`

| Property | Value |
|---|---|
| Type | `string` enum |
| Required | Yes |
| Allowed values | `"High"` \| `"Medium"` \| `"Low"` |
| Purpose | Overall AI confidence in the coloring section given the photo quality |

---

### Section: `proportions`

Describes observable proportions that affect garment fit and styling. Used by the AI to evaluate whether a garment's cut and silhouette is appropriate. Used by Phase 5 Virtual Try-On as a baseline.

**Important constraint:** This section describes proportions in the context of how garments fit and drape. It must never assign numerical measurements, BMI values, weight estimates, or comparative body evaluations. Language is always garment-centric, not body-centric.

```json
"proportions": {
  "frame_width": "medium",
  "torso_length": "average",
  "shoulder_breadth": "medium",
  "visible_posture_notes": null,
  "confidence": "Medium"
}
```

#### `proportions.frame_width`

| Property | Value |
|---|---|
| Type | `string` enum \| `null` |
| Required | Yes (nullable) |
| Allowed values | `"narrow"` \| `"medium"` \| `"broad"` \| `null` |
| Purpose | Informs which garment silhouettes and cuts complement the user's frame |
| Future usage | Shopping: filter by cut type known to work at this frame width |
| AI constraint | Descriptive relative to garment fit, never as a body score |

#### `proportions.torso_length`

| Property | Value |
|---|---|
| Type | `string` enum \| `null` |
| Required | Yes (nullable) |
| Allowed values | `"short"` \| `"average"` \| `"long"` \| `null` |
| Purpose | Affects which garment lengths (shirts, jackets, tops) create balanced proportions |
| Future usage | Shopping: recommend lengths based on torso proportion |

#### `proportions.shoulder_breadth`

| Property | Value |
|---|---|
| Type | `string` enum \| `null` |
| Required | Yes (nullable) |
| Allowed values | `"narrow"` \| `"medium"` \| `"broad"` \| `null` |
| Purpose | Affects which necklines, shoulder styles, and jacket cuts work well |
| Future usage | Shopping: shoulder style recommendations |

#### `proportions.visible_posture_notes`

| Property | Value |
|---|---|
| Type | `string` \| `null` |
| Required | No (optional) |
| Max length | 100 characters |
| Purpose | Observable posture characteristics that affect how garments drape or appear (e.g., "slight forward lean visible in photo") |
| Constraint | Must be garment-relevant only; must not be health or posture-correction advice |

#### `proportions.confidence`

| Property | Value |
|---|---|
| Type | `string` enum |
| Required | Yes |
| Allowed values | `"High"` \| `"Medium"` \| `"Low"` |
| Purpose | AI confidence in the proportions section; expected to be lower for cropped or partial-body photos |

---

### Section: `aesthetic_signals`

Observable signals about the user's current styling choices that the AI can use to infer aesthetic preferences without relying solely on self-reported preferences.

```json
"aesthetic_signals": {
  "current_outfit_formality": "smart casual",
  "current_outfit_style": ["minimalist", "classic"],
  "accessory_presence": "minimal",
  "pattern_preference_signal": "solid",
  "confidence": "High"
}
```

#### `aesthetic_signals.current_outfit_formality`

| Property | Value |
|---|---|
| Type | `string` enum \| `null` |
| Required | Yes (nullable) |
| Allowed values | `"casual"` \| `"smart casual"` \| `"business casual"` \| `"business formal"` \| `"formal"` \| `null` |
| Purpose | The formality the user is currently dressed at provides a strong baseline signal for their comfort level and typical dressing habits |
| Future usage | Analysis: baseline formality for evaluating new purchases |

#### `aesthetic_signals.current_outfit_style`

| Property | Value |
|---|---|
| Type | `string[]` |
| Required | Yes |
| Allowed values | Items from: `"minimalist"`, `"classic"`, `"streetwear"`, `"casual"`, `"bohemian"`, `"sporty"`, `"romantic"`, `"edgy"`, `"preppy"`, `"eclectic"` |
| Min items | 0 |
| Max items | 3 |
| Purpose | Style labels observed from what the user is currently wearing; more reliable than self-reported because it reflects actual behavior |
| Future usage | Analysis: match new garments against observed aesthetic |

#### `aesthetic_signals.accessory_presence`

| Property | Value |
|---|---|
| Type | `string` enum \| `null` |
| Required | Yes (nullable) |
| Allowed values | `"none"` \| `"minimal"` \| `"moderate"` \| `"statement"` \| `null` |
| Purpose | Informs accessory and layering recommendations in analysis |
| Future usage | Shopping: accessory recommendations |

#### `aesthetic_signals.pattern_preference_signal`

| Property | Value |
|---|---|
| Type | `string` enum \| `null` |
| Required | Yes (nullable) |
| Allowed values | `"solid"` \| `"subtle_pattern"` \| `"bold_pattern"` \| `"mixed"` \| `null` |
| Purpose | Observable pattern usage in current outfit as a proxy for preference |
| Future usage | Shopping: filter by pattern type |

#### `aesthetic_signals.confidence`

| Property | Value |
|---|---|
| Type | `string` enum |
| Required | Yes |
| Allowed values | `"High"` \| `"Medium"` \| `"Low"` |

---

### Section: `style_keywords`

A concise set of AI-generated style labels that summarize the user's observed aesthetic identity. These are the labels that will appear on the user-facing profile display.

```json
"style_keywords": [
  {
    "keyword": "Minimalist",
    "confidence": "High",
    "source": "observed"
  },
  {
    "keyword": "Classic",
    "confidence": "High",
    "source": "observed"
  }
]
```

#### `style_keywords[]`

| Property | Value |
|---|---|
| Type | `array` of objects |
| Required | Yes |
| Min items | 1 |
| Max items | 5 |

#### `style_keywords[].keyword`

| Property | Value |
|---|---|
| Type | `string` |
| Required | Yes |
| Allowed values | From: `"Minimalist"`, `"Classic"`, `"Streetwear"`, `"Casual"`, `"Bohemian"`, `"Sporty"`, `"Romantic"`, `"Edgy"`, `"Preppy"`, `"Eclectic"`, `"Business"`, `"Trendy"` |
| Purpose | Human-readable style summary for display and for cross-referencing with garment style labels |

#### `style_keywords[].confidence`

| Property | Value |
|---|---|
| Type | `string` enum |
| Required | Yes |
| Allowed values | `"High"` \| `"Medium"` \| `"Low"` |

#### `style_keywords[].source`

| Property | Value |
|---|---|
| Type | `string` enum |
| Required | Yes |
| Allowed values | `"observed"` \| `"inferred"` |
| Purpose | `"observed"` = visible in current outfit; `"inferred"` = deduced from coloring, proportions, or aesthetic signals |
| Future usage | Transparency layer in Phase 4 to explain why certain recommendations were made |

---

### Section: `wardrobe_context`

Reserved for Phase 4 (Wardrobe Memory). Included in Phase 3 schema as nullable/empty to avoid a breaking schema change when Phase 4 is implemented.

```json
"wardrobe_context": {
  "visible_garment_notes": null,
  "color_palette_notes": null
}
```

#### `wardrobe_context.visible_garment_notes`

| Property | Value |
|---|---|
| Type | `string` \| `null` |
| Required | No |
| Max length | 200 characters |
| Purpose | Notes on the garments visible in the profile photo that are relevant to wardrobe cohesion (e.g., "user is wearing a classic navy blazer — strong wardrobe anchor piece") |
| Phase | Phase 4 |

#### `wardrobe_context.color_palette_notes`

| Property | Value |
|---|---|
| Type | `string` \| `null` |
| Required | No |
| Max length | 200 characters |
| Purpose | Notes on the user's observable color palette from the profile photo |
| Phase | Phase 4 |

---

### Section: `analysis_notes`

Transparency information about what the AI was and was not able to determine from this photo.

```json
"analysis_notes": {
  "photo_quality": "good",
  "visibility_limitations": ["lower body not visible"],
  "confidence_summary": "High confidence on coloring; medium confidence on proportions due to waist-up photo only."
}
```

#### `analysis_notes.photo_quality`

| Property | Value |
|---|---|
| Type | `string` enum |
| Required | Yes |
| Allowed values | `"excellent"` \| `"good"` \| `"acceptable"` \| `"poor"` |
| Purpose | Overall photo quality assessment used to calibrate how much trust to place in the profile |

#### `analysis_notes.visibility_limitations`

| Property | Value |
|---|---|
| Type | `string[]` |
| Required | Yes |
| Min items | 0 |
| Max items | 5 |
| Allowed values (examples) | `"lower body not visible"`, `"face partially obscured"`, `"low lighting"`, `"background cluttered"`, `"small image"` |
| Purpose | Transparency about what the AI could not assess; shown to user to explain any `null` fields or `Low` confidence |

#### `analysis_notes.confidence_summary`

| Property | Value |
|---|---|
| Type | `string` |
| Required | Yes |
| Max length | 300 characters |
| Purpose | Human-readable summary of the AI's overall confidence and what drove any limitations |
| Future usage | Shown on profile page as a transparency note |

---

## Failure Object: `AIStyleProfileFailure`

Returned when generation is not possible.

```json
{
  "schema_version": "1.0",
  "status": "unable_to_generate",
  "reason": "No person detected in the uploaded photo.",
  "next_step": "Upload a clear photo showing your face and upper body.",
  "confidence": "Low"
}
```

| Field | Type | Required | Purpose |
|---|---|---|---|
| `schema_version` | `string` | Yes | Version tag |
| `status` | `"unable_to_generate"` | Yes | Discriminator |
| `reason` | `string` | Yes | Specific reason for failure |
| `next_step` | `string` | Yes | Actionable instruction for the user |
| `confidence` | `"Low"` | Yes | Always `Low` for failures (mirrors existing `UnableToAnalyzeResult` pattern) |

---

## Complete Example: Success

```json
{
  "schema_version": "1.0",
  "generated_at_utc": "2025-01-15T14:32:00Z",
  "status": "complete",
  "coloring": {
    "skin_tone_depth": "medium",
    "skin_tone_undertone": "warm",
    "hair_color": "dark brown",
    "hair_color_family": "dark",
    "eye_color": "brown",
    "high_contrast": false,
    "confidence": "High"
  },
  "proportions": {
    "frame_width": "medium",
    "torso_length": "average",
    "shoulder_breadth": "medium",
    "visible_posture_notes": null,
    "confidence": "Medium"
  },
  "aesthetic_signals": {
    "current_outfit_formality": "smart casual",
    "current_outfit_style": ["minimalist", "classic"],
    "accessory_presence": "minimal",
    "pattern_preference_signal": "solid",
    "confidence": "High"
  },
  "style_keywords": [
    { "keyword": "Minimalist", "confidence": "High", "source": "observed" },
    { "keyword": "Classic", "confidence": "High", "source": "observed" }
  ],
  "wardrobe_context": {
    "visible_garment_notes": null,
    "color_palette_notes": null
  },
  "analysis_notes": {
    "photo_quality": "good",
    "visibility_limitations": [],
    "confidence_summary": "High confidence on coloring and current outfit style. Medium confidence on proportions as only upper body is visible."
  }
}
```

---

## Validation Rules

All validation is performed server-side using Zod before any value is written to `localStorage`.

| Rule | Enforcement |
|---|---|
| `schema_version` must be `"1.0"` | Zod literal |
| `status` must be `"complete"` or `"unable_to_generate"` | Zod discriminated union |
| All enum fields must match allowed values exactly | Zod enum |
| String length limits must not be exceeded | Zod max |
| `style_keywords` array must have 1–5 items | Zod array with min/max |
| `current_outfit_style` array must have 0–3 items | Zod array with max |
| Any field outside the schema is rejected | Zod strict mode |
| Partial objects (missing required fields) are rejected | Zod required fields |
| AI-generated `generated_at_utc` is overwritten by application | Applied after validation |
| Beauty scores, attractiveness ratings, health fields | Absent from schema; any unexpected field causes strict-mode rejection |
