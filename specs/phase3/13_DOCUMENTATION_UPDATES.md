# Documentation Updates — Phase 3

## Document Status
Specification — not yet implemented.

---

## Overview

This document lists every project document that must be updated when Phase 3 is implemented. It specifies exactly what changes are needed in each document. Documents must not be updated until the corresponding implementation milestone is complete. Partial updates (e.g., updating the roadmap before the feature ships) are permitted only for planning entries.

---

## 1. `memory/PRD.md`

**When to update:** After Phase 3 implementation is complete and all acceptance criteria are met.

**Required changes:**

### Add: Phase 3 Feature Description
Add a new section describing the AI Style Profile feature, its inputs, outputs, and relationship to the outfit analysis. Mirror the structure of the existing "Phase 1 Implementation Notes" section.

### Update: MVP Section
The current MVP section lists "Style profile" as a feature. This should be clarified to distinguish between the Phase 1 manual style profile and the Phase 3 AI-generated style profile.

### Update: Non-Goals
Remove "style profile" from the Phase 1 non-goals framing (it was listed as in-scope for Phase 1). Clarify that the Phase 1 profile was manual preference entry and the Phase 3 profile is AI-generated.

### Update: Success Metrics
Add Phase 3 success metrics:
- Profile generation success rate ≥ 90%
- `color` and `style_preference_match` benchmark improvement ≥ 5% with profile present
- All failure states produce defined, non-broken experiences

### Update: Technical Constraints
Add:
- Single multimodal AI call for profile generation
- Profile stored in localStorage only
- Maximum profile generation latency: 8 seconds p95

### Update: Evaluation Dimensions
Note that the `color` and `style_preference_match` dimensions now benefit from AI Profile context when available.

---

## 2. `memory/ROADMAP.md`

**When to update:** Immediately — roadmap changes are planning-level updates.

**Required changes:**

### Update: Phase 3 Description
Current: `Phase 3: Shopping recommendations`

Updated to reflect that Phase 3 now has two sequential sub-milestones:
- Phase 3a: AI Style Profile (this spec)
- Phase 3b: Shopping Recommendations (future spec, depends on AI Style Profile)

The roadmap should clearly indicate that Shopping Recommendations depend on the AI Style Profile being in place.

### Add: Milestone Notes
For each phase entry, note the primary dependency on the previous phase. Example: "Phase 4 (Wardrobe Memory) requires Phase 3a (AI Style Profile) for baseline aesthetic identity."

---

## 3. `memory/CHANGELOG.md`

**When to update:** After Phase 3 implementation is complete and released.

**Required format:** Follow the existing changelog format exactly (version, section headings: Added / Changed / Improved / Files Changed / Reason / Benchmark Motivation / Preserved).

**Required entry:**

```
## v0.5.0 – Phase 3a: AI Style Profile

### Added
- AI Style Profile generation from user photo
- POST /api/generate-profile endpoint
- AIStyleProfile JSON schema with Zod validation
- aiStyleProfileService (localStorage persistence)
- AI Profile section on Profile page (empty, loading, generated, failure states)
- Regeneration flow with confirmation dialog
- Deletion flow with confirmation dialog
- AI profile context injection into outfit analysis
- Analysis page "AI Profile Active" indicator
- Analysis page soft prompt for profile generation
- New AI safety test suite (SAFE-01 through SAFE-08)
- New benchmark cases for profile generation quality
- Augmented analysis benchmark cases (with/without profile comparison)

### Changed
- POST /api/analyze — accepts optional aiStyleProfile field (backward compatible)
- types/schema.ts — new AIStyleProfile type and related types
- lib/services/styleProfileService.ts — extended completion meter to 4 sections
- memory/PRD.md — Phase 3 feature description and success metrics
- memory/ROADMAP.md — Phase 3 sub-milestone structure

### Files Changed
(fill in during implementation)

### Reason
AI Style Profile provides permanent user context that improves color and style preference match
dimensions in outfit analysis, and serves as prerequisite infrastructure for Phase 3b Shopping
Recommendations and Phase 4 Wardrobe Memory.
```

---

## 4. `memory/ARCHITECTURE.md`

**When to update:** After Phase 3 implementation is complete.

**Required changes:**

### Update: Architecture Diagram
Current diagram:
```
Frontend → Input Validation → Single Multimodal AI Call → JSON Schema Validation → Verdict Calculation (app code) → Decision Report UI
```

Extended diagram (add a parallel flow):
```
[Profile Generation Flow]
Profile Page → Photo Upload → Input Validation → Single Multimodal AI Call (profile) → Schema Validation → localStorage

[Analysis Flow — unchanged, now extended]
Frontend → Input Validation → Single Multimodal AI Call (analysis) ← [AI Style Profile context from localStorage]
  → JSON Schema Validation → Verdict Calculation (app code) → Decision Report UI
```

### Add: New Endpoint
Document `POST /api/generate-profile` alongside the existing `POST /api/analyze`. Include:
- Input: single photo (multipart)
- Output: `AIStyleProfile` | `AIStyleProfileFailure`
- Validation: reuses existing `validateImageFile()`
- AI call: single vision call, new system prompt

### Add: New Storage Key
Document `verdict_ai_style_profile` alongside the existing `verdict_style_profile`.

### Update: Failure States Table
Add new failure states for profile generation (see `10_ERROR_HANDLING.md`).

---

## 5. `memory/AI_OUTPUT_SCHEMA.md`

**When to update:** After Phase 3 implementation is complete.

**Required changes:**

### Add: AI Style Profile Schema Section
Add a new section documenting the AI Style Profile output schema. This section should include:
- The full expected JSON structure
- Allowed values for all enum fields
- A note on what the AI must never produce
- The failure object structure

### Clarify Scope
Add a note at the top distinguishing between:
- The **Outfit Analysis Schema** (existing content in this file)
- The **AI Style Profile Schema** (new section)

Both are AI output schemas but they are produced by different AI calls with different system prompts.

---

## 6. `memory/SYSTEM_PROMPT.md`

**When to update:** After Phase 3 implementation is complete.

**Required changes:**

### Clarify Scope
The current `SYSTEM_PROMPT.md` documents the outfit analysis system prompt. It should be clarified at the top that this is the **Outfit Analysis System Prompt**.

### Add: Reference to Profile Generation Prompt
Add a note: "See `STYLE_PROFILE_SYSTEM_PROMPT.md` for the AI Style Profile generation system prompt (Phase 3)."

### No Other Changes
The outfit analysis system prompt itself is not modified in Phase 3. The AI profile is injected as context within the existing prompt structure, not as a change to the system role or evaluation dimensions.

---

## 7. `memory/MEMORY.md`

**When to update:** After Phase 3 implementation is complete, if any new product decisions are made that should be part of permanent project memory.

**Possible additions:**

- If benchmark evidence during Phase 3 reveals new failure patterns in the AI, document them here
- If the AI Safety tests produce any notable findings (e.g., the AI reliably avoids prohibited language when the prompt is structured a certain way), note that
- If Phase 3 produces any changes to the engineering stance (e.g., if a second AI call is proven necessary by benchmark evidence), update the engineering stance section

No changes are required until Phase 3 is implemented and benchmarked. This document should only be updated based on evidence, not plans.

---

## 8. New Documents to Create During Implementation

These documents do not exist yet. They must be created during implementation.

| Document | Location | Purpose |
|---|---|---|
| `STYLE_PROFILE_SYSTEM_PROMPT.md` | `memory/` | The system prompt used for AI Style Profile generation (authored and tested during implementation) |

---

## 9. `specs/phase3/` (This Directory)

**When to update:** These specification documents are updated during implementation if any specification decision changes. Changes must be documented with a rationale note.

**Expected updates during implementation:**
- `05_STYLE_PROFILE_SCHEMA.md` — if AI benchmark testing reveals that certain fields consistently produce unreliable results and should be removed or changed to `null`-only
- `07_AI_ANALYSIS_SPEC.md` — if the augmented analysis prompt design requires changes after initial benchmark results
- `14_PHASE3_EXECUTION_PLAN.md` — milestone status updates as work completes

---

## 10. Documents That Do NOT Require Updates

| Document | Reason |
|---|---|
| `memory/EVALUATION_DATASET.md` | New benchmark cases are added but the format and structure are unchanged |
| `memory/BENCHMARK_RESULTS.md` | Updated with new results as they are generated; no structural changes |
| `types/openai.ts` | OpenAI types for the analysis response are unchanged; new profile types go in `types/schema.ts` |
| `lib/constants/options.ts` | STYLE_OPTIONS, COLOR_OPTIONS, OCCASION_GROUPS are unchanged |
| `components/fashion/DecisionReport.tsx` | Analysis output display is unchanged |
| `app/dashboard/analysis/page.tsx` | Minor additions only (profile indicator + soft prompt); existing logic unchanged |
