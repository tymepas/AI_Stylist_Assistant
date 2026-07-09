# Product Requirements Document (PRD)

## Project Codename
Fashion Decision Assistant (Temporary, final name locked before launch). Working product name for Phase 1: **Verdict**.

## Status
Frozen for Phase 1. Changes come from benchmark evidence, not new ideas.

## Vision
Build an AI powered fashion decision assistant that helps people make confident clothing decisions before spending money.

**Core Promise:** Know before you buy.

## Problem
Users struggle to decide whether clothing suits them, their occasion, and their style before purchasing. Existing tools show products or generate try on images. None explain whether the purchase is actually a good decision.

## Target Users
Online shoppers, students, professionals, event shoppers (interview, wedding, date, first job).

## MVP
Style profile, upload user photo, upload garment, select occasion, AI analysis, decision report.

## Product Principles
1. Decision support over image generation.
2. Explain every recommendation, no unexplained scores.
3. Admit uncertainty once, in the confidence field, not scattered through every sentence.
4. Respect privacy, never claim more than the backend actually does.
5. Respect body image, never judge the person, only the clothing.
6. Build trust through transparency about what was and wasn't considered.
7. **Verdicts are calculated, not invented.** The AI rates each dimension independently. The application computes the overall verdict from those ratings using the fixed formula below. The model never outputs its own overall verdict.

## Evaluation Dimensions
Occasion Compatibility, Color Harmony, Formality, Seasonality, Style Consistency, **Style Preference Match** (does the garment conflict with the user's stated preference; if so, name the conflict directly rather than scoring around it).

Allowed ratings: Excellent, Good, Fair, Poor, Unable to Evaluate
Confidence: High, Medium, Low

## Verdict Calculation (v1 hypothesis, revisit after benchmarking)
Excellent = 5, Good = 4, Fair = 3, Poor = 2, Unable to Evaluate = excluded from the average.

| Dimension | Weight |
|---|---|
| Occasion Compatibility | 30% |
| Formality | 25% |
| Style Preference Match | 20% |
| Color Harmony | 15% |
| Seasonality | 10% |

Weighted average -> verdict: >=4.5 Highly Recommended · 3.5-4.4 Recommended · 2.5-3.4 Consider Alternatives · <2.5 Not Recommended.

## Non Goals
Virtual try on, wardrobe memory, shopping integration, authentication, payments, saved history.

## Technical Constraints
Single multimodal AI request, target latency under 5 seconds, structured JSON output, graceful failure handling.

Image limits: JPEG/PNG/WEBP, max 10MB, minimum 512x512 (1024x1024 recommended).

## Success Metrics
End to end workflow complete. Benchmark dataset of 30 cases, >=90% verdict agreement on clearly good/bad cases. All failure states produce a defined, non broken experience.

## Roadmap
MVP -> Better Evaluation Engine -> Shopping -> Wardrobe Memory -> Virtual Try On -> Production Polish (see ROADMAP.md)

---

## Phase 1 Implementation Notes (this build)
- No real AI, no auth, no database. Style profile persisted client-side (localStorage) only.
- `AnalysisService` (`/app/lib/services/analysisService.ts`) returns realistic mock JSON matching `AI_OUTPUT_SCHEMA.md` exactly, rotating randomly between three scenarios: Highly Recommended, Not Recommended (style preference conflict), Unable to Analyze.
- The application (not the model) computes `overall_recommendation` and `verdict_score` from the weighted formula above — implemented in `computeVerdict()`.
- Backend endpoint: `POST /api/analyze` in `/app/app/api/[[...path]]/route.js`.
