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

### Preserved

- `computeVerdict`, its weights, thresholds, bands and rounding (pinned exhaustively by `tests/evaluation/verdictIntegrity.test.ts`)
- The system prompt files, the model configuration, spend limits and concurrency, and fail-closed behaviour without Redis
- A single-garment request: same request, same prompt version, same response shape
- Shopping Advisor as advice only, with its four qualitative match levels and the Myntra, Amazon and Ajio search links
- Style DNA as optional
