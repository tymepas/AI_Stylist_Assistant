# Product Requirements Document — Phase 3

## Document Status
Specification — not yet implemented.

---

## Overview

Phase 3 introduces the AI Style Profile: an AI-generated, persistent representation of the user's styling identity, derived from a single photo. It supplements and eventually supersedes the manually entered `StyleProfile` that was introduced in Phase 1.

---

## Functional Requirements

### FR-01 — Profile Generation Initiation
The user must be able to trigger AI Style Profile generation from the Profile page. Generation requires uploading a single personal photo. No garment photo is required for this flow.

### FR-02 — Photo Acceptance
The system must accept JPEG, PNG, and WEBP images up to 10MB. The minimum acceptable resolution is 512×512 pixels. These constraints are identical to the existing analysis photo constraints and must use the same validation logic.

### FR-03 — AI Profile Generation
The system must send the photo to the AI and receive a structured response conforming to the AI Style Profile JSON schema (see `05_STYLE_PROFILE_SCHEMA.md`). The AI must never analyze attractiveness, health, weight, or body measurements. The AI must analyze only styling-relevant observable characteristics.

### FR-04 — Schema Validation
The AI response must be validated against the schema before being stored. Any response that fails schema validation must be treated as a generation failure, not a partial success. The raw AI response must never be stored or displayed.

### FR-05 — Profile Storage
The validated AI Style Profile must be stored in `localStorage` under a dedicated key (`verdict_ai_style_profile`), separate from the existing manual profile key (`verdict_style_profile`). Both profiles coexist.

### FR-06 — Profile Display
The Profile page must display the AI-generated profile in a human-readable format when one exists. The display must clearly distinguish AI-generated content from manually entered preferences.

### FR-07 — Profile Injection into Analysis
When an AI Style Profile exists, it must be included in the `POST /api/analyze` request payload. The analysis service must use it to provide richer context to the AI during outfit evaluation.

### FR-08 — Profile Regeneration
The user must be able to regenerate their AI Style Profile at any time by uploading a new photo. Regeneration replaces the existing profile. The user must be informed before regeneration that their current profile will be replaced.

### FR-09 — Profile Deletion
The user must be able to delete their AI Style Profile. Deletion must be a deliberate action (confirmation required). Deletion does not affect the manually entered `StyleProfile`.

### FR-10 — Graceful Degradation
If an AI Style Profile does not exist, all existing functionality must continue to work exactly as it does today. The AI Profile is additive context, not a required precondition for outfit analysis.

### FR-11 — Failure Recovery
Every failure state (image quality, AI error, schema validation failure, timeout) must produce a specific, actionable error message and a clear retry path. No failure state should produce a broken UI, a silent spinner, or an unexplained error.

### FR-12 — Loading State
Profile generation is an AI call with latency comparable to outfit analysis. The UI must show a clear loading state during generation. The loading state must communicate that generation is in progress, not that the app is broken.

---

## User Stories

### US-01 — First-Time Profile Generation
As a new user who has not set up a style profile, I want to upload a photo so the AI can learn my styling identity, so that future outfit recommendations are more accurate without me having to manually answer style questions.

**Acceptance:** User uploads a valid photo → loading state is shown → AI returns valid profile → profile is saved → profile page displays the result → next outfit analysis uses the profile.

### US-02 — Returning User with Existing Profile
As a returning user with an AI Style Profile, I want to see my profile displayed on the Profile page, so that I can understand what the AI knows about my style.

**Acceptance:** Profile page loads → AI-generated profile section is populated with stored profile data → no generation prompt is shown.

### US-03 — Profile Regeneration
As a user whose style has changed, I want to regenerate my profile with a new photo, so that the AI's understanding stays current.

**Acceptance:** User selects regenerate → confirmation prompt appears → user uploads new photo → generation proceeds → new profile replaces old → page reflects updated data.

### US-04 — Analysis with Profile
As a user with an AI Style Profile, when I run an outfit analysis, I want the AI to use my style profile as context, so that the analysis is more personalized.

**Acceptance:** Profile exists in storage → analysis page reads it → it is included in the `/api/analyze` request → AI analysis uses it as context.

### US-05 — Analysis without Profile
As a user without an AI Style Profile, I want outfit analysis to work exactly as it does today, so that the profile is not a required step.

**Acceptance:** No AI profile in storage → analysis proceeds without it → no error is shown → functionality is unchanged.

### US-06 — Profile Deletion
As a user who wants to remove their profile data, I want to delete my AI Style Profile, so that I can start fresh or remove my data.

**Acceptance:** User selects delete → confirmation dialog appears → user confirms → profile is removed from storage → profile page returns to empty state.

### US-07 — Bad Photo Rejection
As a user who uploads a low-quality photo, I want to receive a specific, actionable error message, so that I know how to fix the problem.

**Acceptance:** Photo fails validation (format, size, resolution, or AI cannot process it) → specific error message is shown → user can retry with a better photo.

### US-08 — Manual Profile Preservation
As a user who has manually set style preferences, I want my preferences to be preserved and still editable regardless of whether I generate an AI profile.

**Acceptance:** Manual profile section is always editable → saving manual profile does not affect AI profile → AI profile generation does not overwrite manual preferences.

---

## Success Metrics

| Metric | Target | Measurement Method |
|---|---|---|
| Profile generation success rate | ≥ 90% of valid photo submissions produce a valid profile | Log generation attempts vs. successes |
| Analysis quality improvement | ≥ 5% improvement on `style_preference_match` benchmark score when profile is present | Benchmark comparison: with vs. without profile |
| Color dimension improvement | ≥ 5% improvement on `color` benchmark score when profile is present | Benchmark comparison |
| Generation latency | < 8 seconds p95 | Timing instrumentation on the profile generation API call |
| Schema validation pass rate | ≥ 98% of AI responses pass schema validation | Log validation failures |
| Failure state coverage | 100% of identified failure states produce a non-broken experience | Manual QA checklist |

---

## Scope

**In scope:**

- AI Style Profile generation from a single user photo
- Schema-validated structured profile output
- `localStorage` persistence (same as existing manual profile)
- Profile display on the Profile page
- Profile injection into outfit analysis requests
- Regeneration flow
- Deletion flow
- All failure and error states
- Loading states
- Integration with existing `POST /api/analyze` endpoint (additive only)

**Out of scope:**

- Cloud storage or cross-device sync
- User authentication
- Profile sharing
- Shopping recommendations (separate milestone within Phase 3)
- Wardrobe Memory (Phase 4)
- Virtual Try-On (Phase 5)
- Profile versioning or history
- Export or download of profile data

---

## Assumptions

1. The user has access to a suitable photo (clear, well-lit, at least half-body, single person).
2. localStorage is available and functional in the user's browser.
3. The OpenAI Responses API is available and the existing API key is valid.
4. The AI model used for profile generation is the same GPT-4.1 Vision model used for analysis (to be confirmed during implementation).
5. Profile generation latency is acceptable without streaming (same UX pattern as current analysis loading state).
6. One profile per browser session is sufficient for Phase 3; multi-user household scenarios are out of scope.

---

## Constraints

1. No new external dependencies unless absolutely necessary.
2. No changes to the existing `POST /api/analyze` request contract that would break current clients.
3. No changes to `AI_OUTPUT_SCHEMA.md` — the analysis output schema is frozen.
4. The AI must never produce beauty scores, attractiveness ratings, or health inferences. This is a hard constraint, not a preference.
5. Storage must use the same `localStorage` pattern as the existing manual profile until authentication infrastructure exists.
6. All existing benchmark cases must continue to pass after Phase 3 integration.

---

## Non-Goals

- Building a beauty or attractiveness scoring system (this is explicitly prohibited)
- Analyzing health, weight, age, or body measurements
- Providing dietary, fitness, or cosmetic recommendations
- Replacing the manually entered `StyleProfile` (both coexist)
- Providing a wardrobe management interface
- Generating outfit suggestions unprompted
- Rating the user's appearance
- Comparing users to each other

---

## Edge Cases

| Edge Case | Expected Behavior |
|---|---|
| Photo contains no detectable person | Return `unable_to_generate` with instruction to upload a photo showing the user clearly |
| Photo contains multiple people | Return `unable_to_generate` with instruction to upload a solo photo |
| Photo is cropped to face only | Return `unable_to_generate` with instruction to show at least an upper body |
| Photo is very dark or blurry | Return `unable_to_generate` with instruction to retake in good lighting |
| AI returns partial or malformed JSON | Treat as generation failure; log raw response; show retry |
| AI returns schema-invalid field values | Treat as generation failure; do not display partial data |
| User regenerates while existing profile is in use | New profile replaces old; in-progress analysis sessions (if any) use whatever profile was sent at request time |
| User deletes profile mid-analysis | Analysis uses the profile that was included in the request; deletion is client-side only |
| localStorage is unavailable (private mode, storage full) | Show a graceful error; do not throw uncaught exceptions |
| Network timeout during generation | Show timeout error with retry option; do not leave spinner running |

---

## Acceptance Criteria

1. A user can navigate to the Profile page and see a "Generate AI Style Profile" option when no AI profile exists.
2. Uploading a valid photo initiates generation and shows a loading state.
3. A successfully generated profile is displayed in a human-readable format on the Profile page.
4. The generated profile is stored in `localStorage` under `verdict_ai_style_profile`.
5. Running an outfit analysis when a profile exists includes the profile in the request payload.
6. Running an outfit analysis when no profile exists works without error.
7. Regeneration replaces the existing profile after confirmation.
8. Deletion removes the profile from storage after confirmation and returns the page to empty state.
9. Every documented failure state (see `10_ERROR_HANDLING.md`) produces a specific error message and a clear retry or resolution path.
10. No existing benchmark cases regress after Phase 3 integration.
11. The manually entered style preferences remain editable and functional.
12. The AI never produces a response containing beauty scores, attractiveness ratings, or health inferences. This is verified by the test suite.
