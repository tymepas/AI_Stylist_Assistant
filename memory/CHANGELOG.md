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