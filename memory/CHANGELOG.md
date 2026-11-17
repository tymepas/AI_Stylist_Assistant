# Changelog

All notable changes to Verdict AI are documented here.

---

## v0.1.0 – Phase 1 (Mock Prototype)

### Added

- Initial dashboard
- Profile page
- Analysis workflow
- Decision Report UI
- Mock analysis engine
- Mock recommendation scenarios
- Verdict calculation algorithm
- Six evaluation dimensions
- Style profile support (local)

---

## v0.2.0 – Phase 2 Foundation

### Added

- Real multipart image upload
- Image validation
- Resolution validation (minimum 512×512)
- Automatic client-side image preparation
- Style profile included in analysis request

### Improved

- Upload reliability
- Validation pipeline

---

## v0.3.0 – Real AI Integration

### Added (v0.3.0)

- OpenAI Responses API integration
- GPT-4.1 Vision support
- Runtime schema validation
- Separate OpenAI provider layer
- Server-side verdict calculation
- Raw model output mapping
- Timeout handling
- Rate limit handling
- Provider error handling

### Improved

- Structured JSON validation
- Security
- Prompt loading from SYSTEM_PROMPT.md

---

## v0.3.1 – Evaluation Infrastructure

### Added

- 30 benchmark evaluation cases
- Benchmark tracking
- Evaluation dataset
- Versioned benchmark results
- AI quality measurement process

---

## v0.4.0 – Phase 2.4 Smart Occasion System

### Changed

- **Occasion taxonomy expanded** — replaced the 8-item flat list with a 32-item grouped taxonomy across five categories: Work (9), Social (7), Formal (5), Casual (6), Outdoor / Seasonal (5).
- **Occasion selector grouped** — the analysis page `Select` now uses `SelectGroup` / `SelectLabel` sections (Radix UI / shadcn/ui), preserving full keyboard navigation (Arrow, Tab, Enter, Escape).
- **Label copy updated** — "What is this for?" replaced with "Choose the occasion" (label) and "Where will you wear this outfit?" (description).

### Files Changed

- `lib/constants/options.ts` — Added `OccasionGroup` interface and `OCCASION_GROUPS` constant; `OCCASION_OPTIONS` is now derived from it (flat, for profile page compatibility). No breaking change to existing consumers.
- `app/dashboard/analysis/page.tsx` — Switched import from `OCCASION_OPTIONS` to `OCCASION_GROUPS`; added `SelectGroup` / `SelectLabel` to grouped rendering; updated label copy.
- `memory/CHANGELOG.md` — This entry.

### Reason

Benchmark Case 005 ("Startup Interview") could not be reproduced because the UI offered no matching occasion. The closest available option ("Formal Event") produced a stricter evaluation and artificially lowered the verdict score. The occasion taxonomy limitation was identified as a UX gap, not an AI reasoning gap.

### Benchmark Motivation

Expanding the occasion list to include "Startup Interview", "Networking Event", "Client Presentation", "Coffee Date", "Dinner Date", "Wedding Guest", "Black Tie Event", and "Business Casual" allows all current and planned benchmark cases to be reproduced exactly without substituting occasions. Case 005 can now be re-run with the correct occasion.

### Preserved

- Backend API unchanged — `occasion` continues to be sent as a plain `string`.
- No schema changes, no API route changes, no AI logic changes.
- Compare Another Outfit, Start New Analysis, photo thumbnail, loading animation, upload validation, style profile, and report rendering are all unaffected.
---

## Unreleased - Phase 4 Shopping Advisor

### Added

- Advisory shopping alternatives returned as part of the existing single analysis call
- Strict recommendation validation isolated from core verdict validation
- Qualitative match labels and expected-outcome guidance
- Application-generated Myntra, Amazon, and Ajio search links

### Preserved

- Deterministic verdict calculation, weights, thresholds, and report dimensions
- Existing multipart upload and Style DNA privacy model
- No retailer API, scraping, affiliate links, or saved shopping data

---

## Unreleased - Stage 1 Camera Capture and Image Preparation

### Added

- Camera capture through native file inputs: front camera for the personal photo and Style DNA, rear camera for the garment, each with a separate gallery/file picker
- Preview, retake and remove for every photo
- Browser image preparation (`lib/images/prepareImageForUpload.ts`): orientation, 1,536 px long edge, JPEG re-encode on a white background, about 1 MB per image, 4.0 MB request budget
- Upload helper (`lib/services/uploadRequest.ts`): double-submit protection, 70-second client timeout, no automatic retries, distinct errors for offline, network failure and HTTP 400, 413, 429 and 503
- Component tests with React Testing Library

### Changed

- Photos are always re-encoded before upload, so EXIF metadata (including GPS position) is no longer sent
- Source photos up to 25 MB are accepted in the browser; the server limit of 10 MB per uploaded image is unchanged
- HEIC/HEIF photos are refused with a specific message instead of a generic one

### Preserved

- Deterministic verdict calculation, prompts, schemas, model configuration and spend guard
- Server-side upload validation
- Desktop drag and drop and file selection

---

## Unreleased - Evaluation harness, image intake, garment modes and redesign

### Added

- Evaluation: a synthetic scenario dataset (54 cases), per-case checks with failure reasons, a report summary, latency and cost when measured, partial runs, regression classification against a committed baseline, and an explicit, protected baseline update (`evaluation/README.md`)
- Server-side image intake with `sharp`: content validation, pixel and request size limits, orientation, metadata stripping and re-encoding, before any spend reservation or model call
- Garment modes chosen by the user: one garment photo, two or three views of one garment, or two or three items of one outfit, with per-item notes for outfits
- A six-step analysis journey: photo, garment mode, garment photos, occasion, optional style preferences, review
- A design system (tokens, typography, motion with reduced-motion support) and redesigned dashboard, navigation, analysis journey, decision report, Shopping Advisor, history and settings

### Changed

- Output schema `analysis-output/2`: adds the optional `outfit_components` block. Every `/1` output is still valid
- The decision report states when a verdict rests on few or uncertain ratings, and shows each dimension's weight
- Fonts are self-hosted through `next/font`; the Google Fonts stylesheet import is removed
- Privacy wording in history and settings now says what actually happens: photos are sent for analysis and not kept; reports are not saved

### Fixed

- Mock mode with Style DNA lost the whole Shopping Advisor, so its "Why it is suggested" explanations never appeared (seen on Preview). The mock route passed the application-shaped advisor to the validator for model output, which rejected it
- A Shopping Advisor or per-item outfit block that cannot be used is now stated in one labelled note instead of disappearing without a trace, and the drop is logged with schema paths only
- The report leaves out a section that has nothing to show, and says so when a rating has no explanation, instead of showing a heading over an empty space
- "Things to consider" and "What this is based on" stack at tablet width, where the sidebar leaves too little room for two columns

### Preserved

- `computeVerdict`, its weights, thresholds, bands and rounding (pinned exhaustively by `tests/evaluation/verdictIntegrity.test.ts`)
- The system prompt files, the model configuration, spend limits and concurrency, and fail-closed behaviour without Redis
- A single-garment request: same request, same prompt version, same response shape
- Shopping Advisor as advice only, with its four qualitative match levels and the Myntra, Amazon and Ajio search links
- Style DNA as optional

---

## Unreleased - Evaluation Framework 2.0

### Added

- Reference sets with provenance (`verdict-reference-set/1`): reviewer, review date, basis, status, image hashes and the right to use each image. Four tiers keep human-reviewed images apart from brief-derived, synthetic and unreviewed expectations
- Per-dimension metrics for the six dimensions: exact agreement, agreement within one band, mean absolute error and coverage, each with its sample size and a status (`measured`, `insufficient_sample`, `unavailable`)
- Explanation grounding against reviewer-listed facts: mentioned and missing facts, contradictions, claims about details that cannot be seen, uncertainty handling. Labelled as a proxy
- Confidence calibration: agreement by stated confidence, high-confidence error rates, the confidence gap and the ordering of levels
- Image-mode evaluation: results per garment mode, outfit note completeness, outfit garment type accuracy, comparison groups for one photo against several
- Metric-level regression classification with a minimum sample and a noise margin, included in baseline protection
- Run records with a run id and timestamps, kept apart from the deterministic report
- Human review guide, rubric, stub generator (`npm run eval:review-stubs`) and validator (`npm run eval:references`); `npm run eval:replay`
- A deliberately degraded fixture that shows a quality regression being detected although no per-case check fails

### Changed

- Evaluation report format `verdict-evaluation-report/3`. Every `/2` field is unchanged; the `scenarios-v1` baseline was refreshed through `npm run eval:baseline`
- The benchmark dry run prices each case at its own number of images instead of pricing every call as a two-image call

### Preserved

- `computeVerdict`, the system prompts, the output schema, the model configuration and the spend safeguards: no production code changed
- Mock and replay stay deterministic and free; the evaluation command has no live mode; the $10 benchmark hard cap and its opt-in phrase

### Not measured

- No model accuracy figure exists yet. The golden dataset is empty until real images are reviewed, and scoring them needs a separately approved live run

---

## Unreleased - Phase 4 Milestone 0: preparation for a first measured baseline

Preparation only. No model was called, nothing was spent, and no prompt, output schema, model setting, verdict rule or spend safeguard changed.

### Added

- Synthetic Style DNA in the benchmark manifest (`style_dna`): an invented profile per case, checked with the production validator and size limit. Only `source: "synthetic"` is accepted. A library of five invented personas, two of them aesthetic-only for use next to real photos
- Dataset composition in every report, in the benchmark dry run and in the reference validator: cases and images counted apart, cases per garment mode against a minimum of ten, cases with Style DNA
- Second reviews in a reference set (`second_reviews`) and a tool for them (`npm run eval:second-review`): a blind sheet for the second reviewer, and a merge that records both reviews and lists every difference
- Agreement between reviewers per dimension, the list of cases reviewers differ on, and how often the model lies within the reviewers' range
- Shopping Advisor figures: usable block and mistargeted recommendations with Style DNA, unrequested recommendations without
- `scenarios-v2`: the 54 synthetic cases of `scenarios-v1` unchanged plus 25 more, giving 55 single, 12 multi-view and 12 outfit cases, 12 of them with Style DNA, and its own baseline (`npm run eval:scenarios:v2`, `npm run eval:baseline:v2`)
- A golden case plan of 45 cases (21 single, 12 multi-view, 12 outfit, with two reserve cases in each multi-image mode; ten comparison pairs; fourteen with Style DNA) and a case matrix that lists every case with its mode, images, Style DNA, expected abstention and how its results are reported. Both generated by `npm run eval:build-golden-plan`. It holds no image and no rating
- A review rubric with an anchor for every band of every dimension, and a procedure for recording reviewer disagreement (`evaluation/HUMAN_REVIEW.md`)

### Changed

- Evaluation report format `verdict-evaluation-report/4`. Every `/3` field is unchanged. The `scenarios-v1` baseline was refreshed through `npm run eval:baseline`: its dataset fingerprint and every existing figure are identical, and only the new sections were added
- The live validation plan now has 45 cases instead of 37: every garment mode reaches ten, and each multi-image mode has two reserve cases. The reservations add up to $5.11 at three runs per case and $3.41 at two (was $4.12 for 37 cases at three runs). These are sums of reservations from configured bounds, not a guaranteed maximum spend: the per-image token bound is an assumption
- Reference-dependent figures are compared between two reports on the first reviews only (`scoring_fingerprint`). A change to any first review still makes them incomparable. A second review, or a bump of the hand-kept `dataset_version` with no review changed, no longer does: neither can move a figure, and a comparison that is switched off hides a regression. Reports written before this are compared on the full fingerprint as before
- A comparison names the figures that are new in a report and so were not gated
- The benchmark runner passes a case's synthetic Style DNA profile to the analysis. Cases without one are sent exactly as before

### Preserved

- `computeVerdict`, its weights, thresholds and bands; the system prompts; the output schemas; the model configuration and output token limits; the spend safeguards; API keys and environment variables
- `scenarios-v1`, its 54 cases and outputs, and the protection its baseline gives
- Mock and replay stay deterministic and free; the evaluation command has no live mode; the benchmark's opt-in phrase and $10 hard cap
- Synthetic results stay apart from image-reviewed results: no scenario dataset has a reference set

### Style DNA as a separately reported condition

- Style DNA is a condition on a case, not a garment mode, and a profile changes what the model is told. A report no longer mixes the two conditions silently
- Every figure that combines cases with and without a profile is labelled pooled, in the metric index and at the head of each section of the Markdown summary
- Each figure is also computed for each condition on its own, by the same code as the pooled figure, and listed in the metric index under `style_dna.with_style_dna.` and `style_dna.without_style_dna.`
- A separate figure needs ten cases of its condition. With fewer it is unavailable, with no value; it is not shown as a small-sample number
- Separate figures take part in regression comparison, so a change that affects only one condition is attributed to it
- The reference validator prints which separate figures a dataset can support, before any model is called

### Fixed after two independent reviews, before the pull request

- Adding a second review switched off metric-level comparison, because it changed the only fingerprint; see the change above
- The blind sheet for a second reviewer left out the Style DNA context that the rubric rates against; it now carries it, in the words the model is given, and the hash of each image
- The merge of a second review could write a file the validator refused (a date that does not exist, an over-long note, a fifth review, a sheet for another dataset, a case named twice); it now checks every limit first and adds a sheet completely or not at all
- A second review is refused on a first review that is not finished
- A comparison group may no longer mix Style DNA conditions or style preferences
- A run that rated every dimension Excellent no longer counts against the mistargeted-recommendation figure
- Readiness counts, per garment mode, only cases that can give ratings to score
- Reviewer tables are shown in their own tier's section; hand-written outputs are never labelled "Model"
- The extra single cases of the plan have neutral ids, so an id tells a reviewer nothing about what to expect
- Image counts are called slots, and a synthetic dataset says that none of the files exists

### Not measured

- Still no model accuracy figure. The golden dataset is empty: the plan needs public-licence images, a review of each case, a second review, and a separately approved live run
- The plan has no margin for its ten comparison pairs, its pairs are not independent observations, and within the multi-image modes its figures exist only pooled over Style DNA: eight cases without a profile and four with one are too few for a separate figure
- The dependency audit fails on `picomatch` GHSA-fc5q-39xc-vjpf, on `main` as well. It is left unresolved and is documented in `memory/ARCHITECTURE.md`; no dependency, override or exception was changed
- The colouring part of Style DNA is not exercised on real images, because only aesthetic-only personas go with a real photo
