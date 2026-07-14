# Phase 3 Execution Plan

## Document Status
Specification — not yet implemented.

---

## Overview

Phase 3 is divided into five sequential milestones. Each milestone is independently deliverable: it adds value and does not leave the application in a broken state. Each milestone has explicit completion criteria before the next begins.

**Total estimated complexity:** Large (comparable to Phase 2 AI Integration).

**Critical dependency:** Milestones 1–4 are prerequisites for Milestone 5. Milestones 1–2 are prerequisites for Milestone 3.

---

## Milestone 0 — Specification Validation

**Goal:** Confirm the specification is complete, internally consistent, and understood by the engineer before any code is written.

### Deliverables
- Review all 14 specification documents for contradictions or gaps
- Confirm the AI model to be used for profile generation (same as analysis, or different)
- Verify OpenAI's current API data retention policy and update `11_PRIVACY_AND_SECURITY.md` if needed
- Identify any open questions that would block implementation
- Create the `specs/phase3/` directory structure (this document)

### Dependencies
- None

### Risks
- Specification may have gaps discovered only during implementation → mitigated by thorough spec review before writing code

### Estimated Complexity
Low

### Testing Required
- None (specification review only)

### Completion Criteria
- All 14 spec documents reviewed
- All open questions documented and resolved or explicitly deferred
- Engineer confirms understanding of every acceptance criterion in `02_PRODUCT_REQUIREMENTS.md`

---

## Milestone 1 — Type System and Schema Infrastructure

**Goal:** Define all new TypeScript types, Zod validation schemas, and the new storage service. No UI, no API, no AI calls.

### Deliverables

#### 1. New types in `types/schema.ts`
- `AIStyleProfile` interface
- `AIStyleProfileFailure` interface
- `AIStyleProfileStatus` type
- `StyleKeyword` interface
- `ColoringSection` interface
- `ProportionsSection` interface
- `AestheticSignalsSection` interface
- `StyleKeywordItem` interface
- `WardrobeContext` interface
- `AnalysisNotes` interface
- Extend `AnalyzeRequestPayload` with optional `aiStyleProfile?: AIStyleProfile` field

#### 2. New Zod schema in `lib/services/openai/aiStyleProfileSchema.ts`
- Full Zod schema matching the `AIStyleProfile` interface
- `validateAIStyleProfile(value: unknown): AIStyleProfile` export
- Mirrors the structure of existing `openAIAnalysisSchema.ts`

#### 3. New service `lib/services/aiStyleProfileService.ts`
- `STORAGE_KEY`, `CURRENT_SCHEMA_VERSION` constants
- `getProfile(): AIStyleProfile | null`
- `saveProfile(profile: AIStyleProfile): void`
- `clearProfile(): void`
- `isProfileComplete(profile: AIStyleProfile | null): boolean`
- Schema version validation on read
- Corrupt JSON handling on read
- SSR guard (`typeof window === 'undefined'`)

#### 4. Extend `lib/services/styleProfileService.ts`
- Update `getProfileCompletion()` to accept an optional `aiProfile` parameter
- Return 4-section completion instead of 3-section

### Dependencies
- None (no existing files are modified beyond `types/schema.ts` and `styleProfileService.ts`)

### Risks
- Schema field set may need adjustment after AI testing (Medium probability; mitigated by benchmark testing in Milestone 3)
- TypeScript strict mode may surface complexity in discriminated union types (Low probability)

### Estimated Complexity
Medium

### Testing Required
- All SV-01 through SV-17 schema validation unit tests
- All ST-01 through ST-10 storage service unit tests
- All LS-01 through LS-06 localStorage tests
- Run `tsc --noEmit` — zero type errors required

### Completion Criteria
- All schema validation tests pass
- All storage service tests pass
- `tsc --noEmit` is clean
- No changes to existing behavior (profile page still works, analysis still works)

---

## Milestone 2 — API Endpoint

**Goal:** Implement `POST /api/generate-profile`. Mock mode returns a canned valid profile. OpenAI mode makes the real AI call.

### Deliverables

#### 1. New API route handling in `app/api/[[...path]]/route.js`
- Add `POST /api/generate-profile` route handler
- Input validation: photo presence, type, size, byte-level format, dimensions (reuse `validateImageFile()`)
- Mock mode: return canned `AIStyleProfile` after 1.5–2.5 second simulated delay
- OpenAI mode: call new `generateProfileWithOpenAI()` function
- Schema validation of AI response using `validateAIStyleProfile()`
- Set `generated_at_utc` after validation
- Error handling: all FG-01 through FG-15 error states
- Follow exact same pattern as existing `/api/analyze` handler

#### 2. New `lib/services/openai/openAIProfileService.ts`
- `generateProfileWithOpenAI({ photo: File }): Promise<AIStyleProfile | AIStyleProfileFailure>`
- Loads system prompt from `memory/STYLE_PROFILE_SYSTEM_PROMPT.md`
- Single image input (no garment, no occasion)
- Timeout: 30 seconds (longer than analysis)
- Error handling: reuse `OpenAIAnalysisError` class
- Schema validation: call `validateAIStyleProfile()`
- Mirrors the structure of `openAIAnalysisService.ts`

#### 3. Mock profile data
- Two canned mock profiles: one with all fields populated, one with several null fields
- Stored in service file or constants file
- Rotates randomly (same pattern as existing mock analysis)

#### 4. `memory/STYLE_PROFILE_SYSTEM_PROMPT.md` (first draft)
- Author the profile generation system prompt
- Include all safety constraints from `07_AI_ANALYSIS_SPEC.md`
- Include allowed enum values for all fields
- Include the `unable_to_generate` instruction
- This prompt will be iterated during Milestone 3 benchmarking

#### 5. Extend `POST /api/analyze`
- Add parsing of optional `aiStyleProfile` field
- Implement `parseAIStyleProfile()` with graceful degradation pattern
- Inject parsed profile into OpenAI analysis context when present

### Dependencies
- Milestone 1 (requires `AIStyleProfile` types and `validateAIStyleProfile()`)

### Risks
- OpenAI mode prompt may need significant iteration before producing schema-valid output (Medium probability; allocate time for prompt tuning)
- The 30-second timeout may be insufficient for complex photos (Low probability; can be increased)
- Profile context injection may cause analysis latency increase (Low probability; measure in testing)

### Estimated Complexity
Large

### Testing Required
- All API-GP-01 through API-GP-11 integration tests
- All API-AX-01 through API-AX-05 integration tests (including existing tests)
- All PA-01 through PA-05 parsing unit tests
- PERF-01 through PERF-06 performance tests (after OpenAI mode implementation)
- SAFE-01 through SAFE-08 safety tests (after OpenAI mode implementation — this requires the real AI)

### Completion Criteria
- All integration tests pass in mock mode
- All integration tests pass in OpenAI mode (requires `ANALYSIS_MODE=openai` and valid API key)
- All safety tests pass
- No regression on existing `/api/analyze` tests
- `STYLE_PROFILE_SYSTEM_PROMPT.md` produces schema-valid output on ≥ 90% of test photos
- Latency meets p95 < 8 seconds in OpenAI mode

---

## Milestone 3 — AI Benchmark and Prompt Tuning

**Goal:** Add new benchmark cases for profile generation. Run, measure, and tune until quality and safety thresholds are met. This milestone is the quality gate before the UI is built.

### Deliverables

#### 1. Benchmark cases for profile generation (add to `memory/EVALUATION_DATASET.md`)
- Minimum 10 profile generation benchmark cases covering:
  - Successful generation from high-quality photo
  - Successful generation from medium-quality photo
  - Correct handling of dark photo
  - Correct handling of blurry photo
  - Correct handling of no-person photo
  - Correct handling of multi-person photo
  - Correct handling of face-only photo
  - Safety check: no beauty language on any photo

#### 2. Benchmark cases for augmented analysis
- Minimum 5 cases comparing analysis quality with/without profile
- At least 2 cases targeting the `color` dimension improvement
- At least 2 cases targeting the `style_preference_match` improvement
- At least 1 regression check (profile present should never make a case worse)

#### 3. Prompt iteration
- Run SAFE-01 through SAFE-08 tests against the current prompt
- Run AI-PG-01 through AI-PG-10 against the current prompt
- Iterate on `memory/STYLE_PROFILE_SYSTEM_PROMPT.md` until all tests pass
- Document each prompt change in a changelog entry within the file

#### 4. Update `memory/BENCHMARK_RESULTS.md`
- Record Phase 3 benchmark results using the existing format

### Dependencies
- Milestone 2 (requires working OpenAI endpoint)

### Risks
- AI model may resist certain safety constraints, requiring significant prompt work (Medium probability; block Milestone 4 until resolved)
- AI may produce inconsistent output for certain photo types, requiring schema simplification (Low probability; address by making more fields nullable)
- Augmented analysis improvement may be lower than 5% target (Low probability; if target is not met, document and reassess target rather than shipping without measurement)

### Estimated Complexity
Medium-Large (iterative; time-bounded)

### Testing Required
- All AI-PG-01 through AI-PG-10 tests
- All BM-P-01 through BM-P-05 augmented analysis benchmarks
- All SAFE-01 through SAFE-08 safety tests

### Completion Criteria
- All safety tests pass (SAFE series) — **non-negotiable**
- Profile generation success rate ≥ 90% on valid photo test cases
- `unable_to_generate` returned correctly for all 4 identified failure photo types
- Augmented analysis shows ≥ 5% improvement on `color` or `style_preference_match` (or documented explanation if target not met)
- All 30 existing benchmark cases still pass

---

## Milestone 4 — UI Implementation

**Goal:** Build all UI components for the Profile page AI Style Profile section and the Analysis page integration. No new AI work in this milestone — the API is already complete.

### Deliverables

#### 1. Profile page extension (`app/dashboard/profile/page.tsx`)
- Add `AIStyleProfileSection` component above the existing manual preferences section
- Implement the four display states: Empty, Loading, Generated, Failure
- Implement photo upload with client-side validation
- Implement photo thumbnail preview and confirmation step
- Implement loading state with status text
- Implement generated profile display using `AIProfileCard`
- Implement failure state with "Try Again" and "Upload a Different Photo" buttons
- Implement "Regenerate" button with `RegenerateConfirmDialog`
- Implement "Delete" button with `DeleteProfileConfirmDialog`
- Integrate with `aiStyleProfileService` for read/write/delete
- Integrate profile completion meter (4-section)

#### 2. New components (`components/fashion/`)
- `AIStyleProfileSection` — state machine container
- `AIProfileCard` — structured profile display
- `ProfileGenerationUpload` — upload + confirmation UI
- `ProfileGenerationLoader` — loading state (may wrap `LoadingAnalysis`)
- `ProfileGenerationError` — failure state (may extend `ErrorState`)
- `RegenerateConfirmDialog` — confirmation dialog
- `DeleteProfileConfirmDialog` — confirmation dialog

#### 3. Analysis page extension (`app/dashboard/analysis/page.tsx`)
- "AI Profile Active" indicator (when profile exists)
- Soft prompt with dismiss (when profile absent and not dismissed)
- Dismissal flag in localStorage (`verdict_profile_prompt_dismissed`)
- Include `aiStyleProfile` in the analysis request payload when present

### Dependencies
- Milestone 1 (types)
- Milestone 2 (API)
- Milestone 3 (prompt validated — UI should not ship until AI safety tests pass)

### Risks
- UI state machine (empty/loading/generated/failure/regenerating) is complex — allocate testing time
- Profile card layout with nullable fields requires careful handling to avoid ugly empty areas
- Confirmation dialogs must be keyboard accessible — use existing `Dialog` component correctly

### Estimated Complexity
Large

### Testing Required
- EC-01 through EC-10 edge case tests
- Manual QA checklist (all items)
- Accessibility checks
- Responsive checks (375px, 768px, 1280px)

### Completion Criteria
- All four display states render correctly and transition cleanly
- All confirmation dialogs work (keyboard + mouse)
- All error states from `10_ERROR_HANDLING.md` produce correct UI
- No new TypeScript errors (`tsc --noEmit` clean)
- Manual QA checklist fully completed with no unresolved issues
- Analysis page integration tested end-to-end with a stored AI profile

---

## Milestone 5 — Documentation and Release

**Goal:** Update all project documents, finalize the CHANGELOG, and confirm the release is ready.

### Deliverables

#### 1. Update `memory/PRD.md`
Per `13_DOCUMENTATION_UPDATES.md` — Phase 3 feature description, success metrics, technical constraints.

#### 2. Update `memory/ROADMAP.md`
Per `13_DOCUMENTATION_UPDATES.md` — Phase 3a sub-milestone, updated Phase 3b dependency note.

#### 3. Update `memory/CHANGELOG.md`
Add v0.5.0 entry per the template in `13_DOCUMENTATION_UPDATES.md`.

#### 4. Update `memory/ARCHITECTURE.md`
Per `13_DOCUMENTATION_UPDATES.md` — architecture diagram, new endpoint, new storage key, new failure states.

#### 5. Update `memory/AI_OUTPUT_SCHEMA.md`
Per `13_DOCUMENTATION_UPDATES.md` — add AI Style Profile schema section.

#### 6. Update `memory/SYSTEM_PROMPT.md`
Per `13_DOCUMENTATION_UPDATES.md` — clarify scope, add reference to profile generation prompt.

#### 7. Final acceptance checklist
Run through all items in `12_TESTING_PLAN.md` — Section 10 (Acceptance Checklist). All items must be checked.

### Dependencies
- All previous milestones complete

### Risks
- Documentation update reveals a specification decision that was implemented differently from spec (Low probability; resolve by updating the spec to match the implementation or reverting the implementation)

### Estimated Complexity
Low

### Testing Required
- Final run of full test suite
- Final manual QA checklist
- Final `tsc --noEmit` check

### Completion Criteria
- All acceptance criteria in `12_TESTING_PLAN.md` Section 10 are met
- All documentation updated
- `tsc --noEmit` clean
- No open issues in the implementation that are blocking or high-severity

---

## Milestone Summary

| Milestone | Goal | Complexity | Blocking Milestone | Testing Gate |
|---|---|---|---|---|
| 0 | Specification validation | Low | None | Spec review |
| 1 | Types, schema, storage service | Medium | None | Unit tests |
| 2 | API endpoint | Large | 1 | Integration + safety tests |
| 3 | AI benchmarking and prompt tuning | Medium-Large | 2 | Safety + benchmark tests |
| 4 | UI implementation | Large | 1, 2, 3 | E2E + manual QA |
| 5 | Documentation and release | Low | All | Full test suite |

---

## Risk Register

| Risk | Probability | Impact | Mitigation |
|---|---|---|---|
| AI safety tests fail (beauty/health language in output) | Medium | Blocks release | Allocate prompt tuning time; safety tests are a hard release gate |
| Schema validation pass rate < 90% | Medium | Delays Milestone 3 | Start with simpler schema (more nullable fields); add complexity only after stability |
| Augmented analysis improvement < 5% target | Low | Metric miss | Document honestly; reassess target rather than hiding the result |
| localStorage unavailability in some browsers | Low | Feature degraded | Graceful error message; not a hard blocker |
| OpenAI API latency > 8s p95 | Low | UX degraded | Acceptable to document and revisit; does not block release |
| Specification gap discovered mid-implementation | Medium | Delays milestone | Stop, update spec, confirm change, then continue — do not implement undocumented decisions |

---

## Definition of Done (Phase 3 Complete)

Phase 3 is done when all of the following are true:

1. All five milestones are complete
2. All acceptance criteria in `12_TESTING_PLAN.md` Section 10 are met
3. All safety tests pass (SAFE-01 through SAFE-08)
4. All 30 existing benchmark cases pass
5. At least 10 new benchmark cases added and passing
6. All project documentation updated per `13_DOCUMENTATION_UPDATES.md`
7. `tsc --noEmit` produces zero errors
8. The AI Style Profile section on the Profile page works end-to-end in production mode (`ANALYSIS_MODE=openai`)
9. The augmented analysis works end-to-end with a stored AI profile
10. No P0 or P1 bugs are open
