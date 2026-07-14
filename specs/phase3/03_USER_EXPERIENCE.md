# User Experience Specification — Phase 3

## Document Status
Specification — not yet implemented.

---

## Design Principles

All UX decisions in this document follow the established Verdict design principles:

- Dark theme, minimal, quiet and confident (Apple / Linear inspired)
- No step should require the user to understand AI internals
- Every loading state communicates progress; no silent spinners
- Every failure state communicates a specific problem and a clear resolution
- No step judges, scores, or comments on the user's appearance
- Actions are recoverable: deletion requires confirmation, regeneration requires confirmation

---

## Entry Points

### Entry Point 1 — Profile Page (Primary)
The AI Style Profile section lives on the existing Profile page (`/dashboard/profile`). It is positioned above the manually entered preferences section. This placement communicates that the AI profile is the richer, more comprehensive layer, while the manual preferences remain available.

New users arriving on the Profile page see an empty state for the AI profile with a clear call to action.

### Entry Point 2 — Analysis Page Prompt (Secondary)
When a user runs their first outfit analysis and has no AI Style Profile, the analysis page may surface a one-time prompt: "Generate your AI Style Profile for more personalized results." This is a soft nudge, not a blocker. The user can dismiss it or skip it without affecting analysis functionality.

### Entry Point 3 — Dashboard Widget (Tertiary)
The dashboard summary card may show an "Incomplete profile" indicator when the user has no AI Style Profile. This links to the Profile page. This entry point is a discovery mechanism, not a required step.

---

## Navigation

The AI Style Profile feature lives entirely within the existing Profile page. No new top-level navigation items are required.

Breadcrumb: Dashboard → Profile

The Profile page now has two distinct sections:
1. AI Style Profile (new)
2. Style Preferences (existing manual entry, unchanged)

Both sections are visible on the same page. No tabs or modal navigation is required for Phase 3.

---

## Onboarding — First-Time User Flow

### Step 1 — Profile Page, Empty State
The user arrives on the Profile page. The AI Style Profile section shows an empty state:

- Headline: "Your AI Style Profile"
- Subtext: "Generate a personalized style profile from your photo. It takes one upload and improves every outfit analysis."
- Button: "Generate Profile"
- The section is visually distinct from the manual preferences below it

No manual input is required before triggering generation.

### Step 2 — Photo Upload
Clicking "Generate Profile" opens a photo upload area. The upload area accepts drag-and-drop and click-to-browse. The following is shown:

- Instruction text: "Upload a clear photo showing your face and upper body. Good lighting improves accuracy."
- Accepted formats: JPEG, PNG, WEBP
- Maximum size: 10MB
- Minimum resolution: 512×512 (not shown to users; enforced silently with a specific error if violated)
- A "Cancel" action is available at this step without requiring confirmation

Photo upload at this step is client-side validation only. No AI call is made until the user explicitly confirms.

### Step 3 — Confirmation
After a photo is selected and passes client-side validation, the user sees:

- A thumbnail of the selected photo
- A brief privacy note: "Your photo is sent to our AI for analysis and is not stored on our servers."
- Button: "Analyze Photo"
- Button: "Choose a Different Photo"

This step exists to give the user a moment to confirm before sending data to the AI.

### Step 4 — Loading State
After the user confirms, the photo is sent to the AI. The loading state:

- Replaces the upload area with a loading indicator (spinner or subtle animation consistent with existing `LoadingAnalysis` component patterns)
- Shows status text: "Analyzing your style..." (plain, not technical)
- Does not show a progress percentage (latency is unpredictable)
- The Cancel option is removed during active generation to avoid partial states
- Expected duration: 3–8 seconds

### Step 5 — Success State
The loading state is replaced by the generated profile display:

- Headline: "AI Style Profile Generated"
- The structured profile fields are displayed in a readable format (see `09_UI_SPECIFICATION.md`)
- A subtle success indicator (e.g., a check icon or brief animation) confirms completion
- The "Generate Profile" button is replaced by a "Regenerate" and "Delete" set of actions
- The user does not need to take any further action; the profile is already saved

---

## Returning User Flow

A user who has a previously generated AI Style Profile arrives at the Profile page and sees:

- The AI Style Profile section populated with their stored profile data
- A timestamp or generation context: "Generated from your photo" (no date stored in Phase 3; this is a Phase 4 enhancement)
- "Regenerate" and "Delete" actions
- No upload prompt or call to action

The returning user flow has no loading state and no AI call. It is a pure data display from `localStorage`.

---

## Regeneration Flow

### Trigger
User clicks "Regenerate" on the Profile page.

### Step 1 — Confirmation Dialog
A modal confirmation dialog appears:

- Title: "Regenerate AI Style Profile?"
- Body: "This will replace your current profile. Your manually saved style preferences will not be affected."
- Confirm button: "Regenerate"
- Cancel button: "Keep Current"

The user must explicitly confirm. Clicking outside the modal or pressing Escape cancels without action.

### Step 2 — Photo Upload
Identical to onboarding Step 2. The existing profile remains in storage until generation succeeds.

### Step 3 — Confirmation
Identical to onboarding Step 3.

### Step 4 — Loading State
Identical to onboarding Step 4.

### Step 5 — Success
The new profile replaces the old. The display updates. A brief success indicator is shown.

**Rollback behavior:** If generation fails at any point, the existing profile is preserved. The old profile is never deleted until a new one successfully replaces it.

---

## Deletion Flow

### Trigger
User clicks "Delete" on the Profile page.

### Step 1 — Confirmation Dialog
A modal confirmation dialog appears:

- Title: "Delete AI Style Profile?"
- Body: "Your profile data will be removed from this device. This cannot be undone. Your manually saved style preferences will not be affected."
- Confirm button: "Delete Profile" (destructive styling — red or high-contrast)
- Cancel button: "Cancel"

The user must explicitly confirm. Clicking outside the modal or pressing Escape cancels without action.

### Step 2 — Post-Deletion State
The profile section returns to the empty state (see Onboarding Step 1). The deletion is immediate and local. No success toast is required; the visual change to empty state is confirmation enough.

---

## Failure Flow

### Image Validation Failure (client-side)
Occurs before any AI call. Shown immediately after the user selects a photo.

- Error is shown inline, below the upload area
- Specific messages: see `10_ERROR_HANDLING.md`
- The upload area remains available so the user can select a new photo
- No dismissal required; the error clears when a new photo is selected

### AI Generation Failure (server-side)
Occurs during or after the AI call.

- Loading state is replaced by an error state
- Error message: specific and actionable (see `10_ERROR_HANDLING.md`)
- Button: "Try Again" — returns to the photo upload step with the same photo pre-selected
- Button: "Upload a Different Photo" — clears the current photo and returns to upload step
- If the user had a previous profile, it is preserved and a note states: "Your previous profile is still active."

### Network / Timeout Failure
- Same treatment as AI Generation Failure
- Error message indicates a connection problem, not an AI problem
- "Try Again" retries the same request

### Schema Validation Failure
- Same treatment as AI Generation Failure from the user's perspective
- The raw AI response is never shown to the user
- Error message: "Something went wrong with the analysis. Please try again."
- Internally logged for debugging

---

## Loading States

### Profile Generation Loading
- Duration: 3–8 seconds (estimated)
- Display: spinner/animation + "Analyzing your style..." text
- The rest of the Profile page (manual preferences section) remains visible and accessible during loading
- No interaction with the loading state is permitted (no cancel)

### Profile Display Loading (returning user)
- Duration: < 100ms (localStorage read)
- No visible loading state required; data renders immediately

---

## Retry Flow

### From Failure State
The user sees the failure state with "Try Again" and "Upload a Different Photo" buttons.

- "Try Again": resubmits with the same photo (same validation, same AI call)
- "Upload a Different Photo": clears the selection and returns to the upload step

There is no automatic retry. Retries are always user-initiated.

### Maximum Retries
No hard limit on retries in Phase 3. Rate limiting is enforced at the API level (existing behavior).

---

## Empty State

Shown when no AI Style Profile exists.

- Visual treatment: subtle placeholder card, not a blank area
- Headline: "Your AI Style Profile"
- Body: "Generate a personalized style profile from your photo. It takes one upload and improves every outfit analysis."
- CTA button: "Generate Profile"
- No error indicators
- No sample or placeholder data (do not fabricate profile content)

---

## Success State

Shown immediately after successful generation and on all subsequent visits.

- Headline: "AI Style Profile"
- Profile fields displayed in human-readable format
- "Regenerate" secondary action (quieter visual weight than primary actions)
- "Delete" tertiary action (quieter still; destructive actions should not be prominent)
- No "edit" capability — the profile is AI-generated, not manually editable

---

## Profile Update Flow

"Profile Update" is functionally identical to Regeneration. There is no partial update or field-by-field editing. The profile is atomic: it is generated as a whole from a photo and replaced as a whole.

This is intentional. Allowing partial manual edits to an AI-generated profile creates inconsistency and undermines trust in the profile's integrity.

---

## Analysis Page Integration

### When Profile Exists
- The analysis page reads the AI Style Profile from `localStorage` at page load
- A subtle indicator is shown: "Using your AI Style Profile" (e.g., a small profile icon with label)
- No change to the analysis flow is required from the user's perspective
- The profile is silently included in the analysis request

### When Profile Does Not Exist
- The analysis page shows a soft prompt (dismissable): "Add a Style Profile for more personalized results"
- This prompt links to the Profile page
- Dismissing the prompt saves a flag in `localStorage` so it is not shown again
- The analysis proceeds normally without a profile

### After Analysis
- The existing post-analysis UX (Decision Report) is unchanged
- The profile's influence on the result is not explicitly surfaced to the user in Phase 3 (this is a Phase 4 transparency feature)
