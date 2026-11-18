# AI OUTPUT SCHEMA

Version: `analysis-output/3` (`ANALYSIS_OUTPUT_SCHEMA_VERSION` in `lib/services/openai/openAIAnalysisSchema.ts`).

This document describes the output contract that the code enforces. The
machine-enforced schemas are the source of truth:

| Block | Schema | Validated |
|---|---|---|
| Status, six dimensions | `lib/services/openai/openAIAnalysisSchema.ts` | Strictly. An invalid core makes the whole response invalid |
| `observations` | `lib/services/openai/observationsSchema.ts` | Separately. Invalid or missing: unavailable, nothing else changes |
| `evidence` | `lib/services/openai/ratingEvidenceSchema.ts` | Separately, per dimension. Invalid dimensions are dropped, the others kept |
| `shopping_advisor` | `lib/services/openai/shoppingRecommendationSchema.ts` | Separately. Invalid or missing: unavailable |
| `outfit_components` | `lib/services/openai/outfitComponentsSchema.ts` | Separately, `outfit_items` mode only |

The model does **not** receive this file. What it receives is
`memory/SYSTEM_PROMPT.md` (the instructions, including the output shapes) and a
user message that names the image mode and carries the request data
(`buildUserContext` in `lib/services/openai/openAIAnalysisService.ts`).
`tests/versioning/schemaVersions.test.ts` fails if any schema above changes
without a version bump; `tests/versioning/promptVersion.test.ts` and
`tests/core/garmentModes.test.ts` record the prompt versions.

## Status

`complete` or `unable_to_analyze`. Nothing else is accepted.

## Complete

```json
{
  "status": "complete",
  "observations": { "images": [ ... ], "views": { ... } },
  "dimensions": {
    "occasion":               { "rating": "", "reason": "", "confidence": "" },
    "color":                  { "rating": "", "reason": "", "confidence": "" },
    "formality":              { "rating": "", "reason": "", "confidence": "" },
    "seasonality":            { "rating": "", "reason": "", "confidence": "" },
    "style":                  { "rating": "", "reason": "", "confidence": "" },
    "style_preference_match": { "rating": "", "reason": "", "confidence": "" }
  },
  "evidence": { "occasion": { ... }, "...": "one entry per dimension key" },
  "shopping_advisor": { "recommendations": [] },
  "outfit_components": [ ... ]
}
```

- `rating`: `Excellent` | `Good` | `Fair` | `Poor` | `Unable to Evaluate`.
- `confidence`: `High` | `Medium` | `Low`.
- `reason`: a non-empty string.
- Every object is strict: an unknown key makes the response invalid. In
  particular the model never returns `overall_recommendation`,
  `verdict_score`, `things_to_consider`, `analysis_based_on` or `next_step`:
  the application adds them after it has computed the verdict.
- A top-level `views` key (where `observations.views` belongs) is tolerated
  and ignored, so a misplaced entry can never cost the six ratings; the
  observations are then refused for a missing `views` entry.
- `observations`, `evidence`, `shopping_advisor` and `outfit_components` are
  optional in the schema. Each is validated on its own after the six ratings,
  and none of them is read by `computeVerdict`.

## Unable to analyze

```json
{ "status": "unable_to_analyze", "reason": "", "confidence": "Low", "next_step": "" }
```

## Observations (analysis-output/3)

What is visible in each garment image. The person is never described.

```json
"observations": {
  "images": [
    {
      "image": 1,
      "garment": "blazer",
      "category": "suiting",
      "identification": "observed",
      "colours": { "dominant": ["navy"], "secondary": [] },
      "colour_status": "observed",
      "pattern": "solid",
      "details": ["notched lapels", "two-button front"],
      "limits": []
    }
  ],
  "views": { "same_garment": "yes", "conflicts": "" }
}
```

| Field | Values |
|---|---|
| `image` | Garment image number, 1 to 3. Exactly one entry per garment image sent |
| `garment` | Short plain name, 2 to 32 characters, or `null` when it cannot be identified |
| `category` | `top`, `bottom`, `outerwear`, `dress`, `footwear`, `accessory`, `suiting`, `traditional_wear`, `unclear` |
| `identification`, `colour_status` | `observed`, `uncertain`, `not_visible` |
| `colours` | Broad families only: `black`, `white`, `cream`, `grey`, `beige`, `brown`, `red`, `pink`, `orange`, `yellow`, `green`, `blue`, `navy`, `purple`, `gold`, `silver`, `multicolour`. `dominant` 1 to 2 (0 when the colour is not visible), `secondary` 0 to 2, at most 3 in all |
| `pattern` | `solid`, `striped`, `checked`, `printed`, `textured`, `other`, `unclear` |
| `details` | Up to 3 visible features, 3 to 48 characters each |
| `limits` | Up to 4 of `lighting`, `occlusion`, `cropped`, `blur`, `low_resolution`, `angle`, `image_text`, `several_items` |
| `views` | Required in `same_garment_views` mode, refused in the others. `same_garment`: `yes`, `no`, `unclear`; `conflicts` (up to 100 characters) is required unless `yes` |

Refused (the block becomes unavailable, with a logged problem code):
an entry missing or repeated for an image, or one for an image that was not
sent (`image_mapping`); a missing or misplaced `views` entry; views said to
show one garment while identified as different kinds of garment
(`views_contradiction`); a garment named while `not_visible`
(`identification_inconsistent`); colours for a colour that is not visible, or
none for one that is (`colour_inconsistent`); and any text stating a
material or fibre, a brand, a price, durability, comfort or quality, a link,
or an instruction (`unsupported_text`, `lib/services/openai/claimScreening.ts`).

## Evidence (analysis-output/3)

What each rating rests on. It points at facts; it does not explain the rating
again (the `reason` does that).

```json
"evidence": {
  "color": {
    "sources": ["person_photo", "garment_images"],
    "cites": ["g1.colour"],
    "support": "partial",
    "missing": "Warm lighting changes the colour"
  }
}
```

| Field | Values |
|---|---|
| `sources` | 1 to 5 of `person_photo`, `garment_images`, `occasion`, `style_preferences`, `style_dna`. Only inputs that were actually sent |
| `cites` | Up to 4 references to observations: `g<image>.type`, `g<image>.colour`, `g<image>.pattern`, `g<image>.d<detail>` |
| `support` | `sufficient`, `partial`, `insufficient` |
| `missing` | What was missing or unclear, up to 80 characters. Required unless `sufficient` |

Each dimension is checked on its own. A dimension's evidence is dropped when it
cites an observation that does not exist or was reported as not visible
(`invalid_citation`; with no valid observations, every citation is invalid),
cites observations without naming `garment_images` (`source_mismatch`), names
Style DNA or style preferences that were not sent (`unsupplied_source`), states
support that contradicts its rating (`support_conflict`: an unrated dimension
with `sufficient`, a rated one with `insufficient`), leaves out what was
missing (`missing_unexplained`) or makes an unsupported claim
(`unsupported_text`). The result is `available` (six dimensions), `partial`
or `unavailable`.

## Shopping Advisor

```json
"shopping_advisor": {
  "recommendations": [
    {
      "title": "",
      "garment_type": "top | bottom | outerwear | dress | footwear | accessory | suiting | traditional_wear",
      "color_direction": "",
      "style_direction": "",
      "rationale": "",
      "addresses": ["occasion"],
      "match_level": "Excellent Match | Strong Match | Good Match | Possible Match"
    }
  ]
}
```

Empty without a Style DNA profile; one to three recommendations with one.
Advisory only: no verdict or score estimate, no retailer, link, price, stock,
discount, brand, material quality, durability or comfort.

## Outfit item notes (outfit_items only)

```json
"outfit_components": [
  { "item": 1, "garment_type": "top", "assessment": "Works well | Works | Needs attention | Unable to tell", "note": "" }
]
```

Exactly one entry per garment image. Ignored in every other mode.

## After validation (what the API returns)

The application computes `overall_recommendation` and `verdict_score` from the
six ratings with `computeVerdict` (`lib/services/analysisService.ts`), and adds
`things_to_consider`, `analysis_based_on` and `next_step`. It attaches the
informational blocks in the application's own shape:

- `observations`: `{ "availability": "available" | "unavailable", "images": [...], "views"?: {...} }`
- `evidence`: `{ "availability": "available" | "partial" | "unavailable", "dimensions": { ... } }`
- `shopping_advisor`: `{ "availability": "available" | "requires_style_dna" | "unavailable", "recommendations": [...] }`
- `outfit_components` and `garment_mode` for multi-image requests.

Nothing in an informational block can change a rating, a weight, a threshold,
the score or the band.

## Occasion context (analysis-output/4, Phase 4 Milestone 2)

The request carries the selected occasion and its profile (`lib/constants/occasionProfiles.ts`). The output shape is
unchanged; the rules for using the profile are stated in the system prompt. The API result adds
`occasion_context`: `{ occasion, profile_version, formality, setting, suits, varies?, season? }`, the profile the
model was given. It is display only.

## Version history

- `analysis-output/1`: the six ratings and the optional shopping advisor.
- `analysis-output/2`: adds the optional `outfit_components` block.
- `analysis-output/3`: adds the optional `observations` and `evidence` blocks. Every `/2` output is still a valid `/3` output, with neither block.
- `analysis-output/4` (Phase 4 Milestones 2 to 4, released together): occasion profiles and their rules (Milestone 2); the sections below describe the fields Milestones 3 and 4 add. Every `/3` output is still a valid `/4` output.
