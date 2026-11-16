# Verdict evaluation

Measures the quality of model output and of the end-to-end verdict without paying
for a model call during ordinary development.

## Three modes

| Mode | What runs | Calls a model | Where |
|---|---|---|---|
| Mock | Hand-written fixture outputs in `evaluation/fixtures/mock/` | Never | `npm test` (so also CI) and `npm run eval` |
| Replay | Model outputs recorded earlier, read from a file | Never | `npm run eval` with `EVAL_MODE=replay` |
| Live | Real calls on the production code path, which also write a recording | Yes | `npm run benchmark` only, with its opt-in phrase and spend cap |

`npm run eval` has no live mode. `EVAL_MODE=live` is refused, a missing recording
is an error, and network access is disabled for the whole run, so the command
cannot fall back to a billable call. Live runs are refused in CI, on Vercel and
with `NODE_ENV=production` (see `benchmark/README.md`).

```bash
npm run eval
```

```bash
EVAL_MODE=replay EVAL_CASES=benchmark/cases.json EVAL_RECORDING=benchmark/results/<file>.recording.json npm run eval
```

Add `EVAL_BASELINE=<earlier report>.json` to print what changed against an earlier report.

## How the pieces fit

1. A live benchmark run writes `<timestamp>-<model>-<effort>.recording.json` next to its results. The recording stores each case's model JSON with the model, reasoning effort, prompt version, schema version and a fingerprint of the manifest.
2. Replay validates every recorded output against the current schema, computes the verdict with the production verdict code, and scores the result.
3. The report is JSON with sorted keys and no timestamps or model text, so two reports can be compared with an ordinary diff. A Markdown summary is written next to it.

Reports go to `evaluation/reports/` (git-ignored). Commit a report deliberately when it should be kept as a baseline.

## Privacy rules

- Use only synthetic images, images under a licence that allows this use, photos you own, or photos from volunteers who approved this use. Never customer photos.
- A recording never contains images, file names, prompts or credentials.
- Model text is stored only for cases whose `source` is `synthetic` or `public_license`. For `owned` and `approved_volunteer` cases the output is withheld, because it describes a real person; those runs are counted as withheld and not scored in replay.
- Recordings of real model outputs stay local (`benchmark/results/` and `evaluation/recordings/` are git-ignored). Review one before committing it.
- Reports contain aggregates, case ids and verdict bands only.

## Metrics

| Group | Metric | Needs labels |
|---|---|---|
| Model | Valid structured output rate, error codes | No |
| Model | Abstention precision, recall and false abstention rate | `expected.should_abstain` |
| Model | Stability across repeated runs: same outcome, band flips, per-dimension rating agreement, score range | No |
| Model | Confidence: distribution, and how often a rating is stable at each stated confidence | No |
| Model | Confidence: how often a rating is acceptable at each stated confidence | Verified `expected.dimension_ratings` |
| Model | Screening hits for prohibited statements and forbidden claims (confirm by review) | `expected.forbidden_claims` |
| Model | Attribute accuracy (garment, colour, pattern) | Not available: the output has no such fields yet |
| End to end | Verdict band agreement | `expected.acceptable_bands` |
| End to end | Adversarial runs outside acceptable bands; outcome change against the clean twin | `twin_of` |
| Application | Recomputing the verdict from the same ratings gives the same result | No |

Model metrics describe the model's output. Application metrics describe Verdict's own deterministic code. End-to-end metrics depend on both, so a change in either can move them. Prompt and model versions are compared by replaying two recordings of the same manifest and comparing the reports.

Every rate is `null` when there is nothing to measure.

## What a report does and does not show

- A mock report checks the harness and the verdict code. It says nothing about model quality.
- Verdict band agreement is not recognition accuracy: a model can reach an acceptable band for the wrong reasons.
- Results describe one model, one prompt version and one dataset. A small dataset gives wide error margins; treat differences of a few cases as noise.

## Labels

A case may carry `labels` (`garment_category`, `colour_family`, `pattern`, `formality`, `expected_uncertainty`) and `expected.dimension_ratings`. Labels describe what is visible in the case's images. They must be assigned by a person looking at those images, not copied from the brief the image was made from, and are scored only when `labels.verified` is `true`.

## Proposed dataset v1 (about 40 cases)

This is a plan for what to create, not a set of labels. Each row needs images to be made or licensed first; expectations and labels are filled in afterwards by a reviewer looking at the actual images.

| Category | Cases | What it tests |
|---|---|---|
| `clear`, expected good match | 5 | Band agreement on unambiguous good matches across different occasions |
| `clear`, expected poor match | 5 | Band agreement on unambiguous mismatches |
| `clear`, borderline | 3 | No expected band; reasoning is reviewed by a person |
| `lighting` | 2 | Warm indoor light and backlighting |
| `camera_angle` | 2 | High angle and side view |
| `resolution` | 1 | The 512 px minimum |
| `rotated` | 1 | A photo with an EXIF orientation tag |
| `single_garment` | 2 | Garment worn rather than laid flat |
| `multiple_garments` | 2 | Several items in the garment photo |
| `blur` | 2 | Expected uncertainty, lower confidence |
| `occluded` | 2 | A key garment detail is hidden |
| `difficult_colour` | 3 | Navy against black, off-white against cream, colour cast |
| `ambiguous_detail` | 2 | Material or construction cannot be determined |
| `adversarial_text` | 3 | Instructions printed on the garment; each has a clean twin among the clear cases |
| `product_claims_text` | 2 | Price, brand or material text on a tag that must not be repeated |
| `insufficient_input` | 3 | No person, no garment, unusable image: the model should abstain |
| **Total** | **40** | |

Run each case three times so stability can be measured. Start from `benchmark/cases.example.json`, which already has one example per category.
