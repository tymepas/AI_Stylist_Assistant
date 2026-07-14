# Error Handling Specification — Phase 3

## Document Status
Specification — not yet implemented.

---

## Design Principles

Every failure state must:
1. Produce a specific, human-readable message (not "Something went wrong")
2. Tell the user exactly what happened
3. Tell the user exactly what to do next
4. Preserve any existing data (do not delete a stored profile because a regeneration failed)
5. Offer a clear retry or resolution path
6. Never leave a spinner running indefinitely
7. Never produce a broken or blank UI

---

## Failure States — Profile Generation

### FG-01 — No Photo Provided

**When:** The user triggers generation but no file is attached to the request.

**HTTP Status:** 400

**Error code:** `missing_image`

**User-facing message:** "Please upload a photo to generate your profile."

**Recovery:** Return to upload step. Upload area is displayed.

---

### FG-02 — Unsupported File Format

**When:** The user uploads a file that is not JPEG, PNG, or WEBP (e.g., GIF, BMP, HEIC, PDF).

**Detection:** Client-side (file type check) and server-side (MIME type validation).

**HTTP Status:** 400

**Error code:** `invalid_upload`

**User-facing message:** "Please upload a JPEG, PNG, or WEBP image."

**Recovery:** Upload area remains open. User selects a different file.

---

### FG-03 — File Too Large

**When:** The uploaded file exceeds 10MB.

**Detection:** Client-side (file size check) and server-side.

**HTTP Status:** 400

**Error code:** `invalid_upload`

**User-facing message:** "Your photo must be smaller than 10MB. Try a slightly smaller image."

**Recovery:** Upload area remains open. User selects a different file.

---

### FG-04 — File Empty or Corrupt

**When:** The uploaded file has zero bytes or the byte-level format check fails (file claims to be JPEG but fails JPEG magic byte check).

**Detection:** Server-side byte validation (reuse existing `validateImageFile()`).

**HTTP Status:** 400

**Error code:** `invalid_upload`

**User-facing message:** "The uploaded file doesn't appear to be a valid image. Please try a different photo."

**Recovery:** Upload area remains open.

---

### FG-05 — Image Too Small

**When:** The image dimensions are below 512×512 px.

**Detection:** Server-side dimension validation (reuse existing logic).

**HTTP Status:** 400

**Error code:** `invalid_upload`

**User-facing message:** "Your photo must be at least 512×512 pixels. Please use a higher resolution photo."

**Recovery:** Upload area remains open.

---

### FG-06 — No Person Detected (AI)

**When:** The AI cannot detect a person in the photo.

**Detection:** AI returns `status: "unable_to_generate"` with an appropriate reason.

**HTTP Status:** 200

**UI State:** Failure state displayed in the AI Profile section.

**User-facing message:** "We couldn't detect a person in the uploaded photo."

**Next step shown:** "Please upload a clear photo of yourself with your face and upper body visible."

**Recovery:** "Try Again" (with same photo) and "Upload a Different Photo" buttons.

---

### FG-07 — Multiple People in Photo

**When:** The AI detects multiple people and cannot determine which to profile.

**Detection:** AI returns `status: "unable_to_generate"`.

**HTTP Status:** 200

**User-facing message:** "Multiple people were detected in the photo."

**Next step shown:** "Please upload a solo photo with only you visible."

**Recovery:** "Upload a Different Photo" button.

---

### FG-08 — Photo Too Dark or Blurry

**When:** Photo quality is insufficient for the AI to make reliable observations.

**Detection:** AI returns `status: "unable_to_generate"`.

**HTTP Status:** 200

**User-facing message:** "The photo quality was too low to analyze your style."

**Next step shown:** "Please retake your photo in good, even lighting with a clear view of your face and upper body."

**Recovery:** "Try Again" and "Upload a Different Photo."

---

### FG-09 — Face/Body Not Sufficiently Visible

**When:** The photo shows only a face (close-up), only a back view, or only feet/legs with no upper body.

**Detection:** AI returns `status: "unable_to_generate"`.

**HTTP Status:** 200

**User-facing message:** "We need to see your face and upper body clearly to generate a profile."

**Next step shown:** "Please upload a photo showing your face and at least your upper body."

**Recovery:** "Upload a Different Photo."

---

### FG-10 — AI Response Schema Validation Failure

**When:** The AI returns JSON that fails Zod validation (missing required fields, invalid enum values, unexpected structure).

**Detection:** Server-side Zod parse failure.

**HTTP Status:** 502

**Error code:** `api_error`

**Logging:** Raw AI response is logged server-side for debugging.

**User-facing message:** "Something went wrong during analysis. Please try again."

**Next step shown:** "If this keeps happening, try uploading a different photo."

**Recovery:** "Try Again" and "Upload a Different Photo."

**Data preservation:** Existing stored profile (if any) is NOT deleted.

---

### FG-11 — OpenAI API Error

**When:** OpenAI returns a 5xx error, returns an empty response, or the connection fails.

**Detection:** `OpenAIAnalysisError` with `code: 'api_error'` (reuse existing error class).

**HTTP Status:** 502

**Error code:** `api_error`

**User-facing message:** "The analysis service is temporarily unavailable. Please try again."

**Recovery:** "Try Again."

---

### FG-12 — AI Call Timeout

**When:** The AI call exceeds 30 seconds without a response.

**Detection:** Request timeout (30s for profile generation vs. existing analysis timeout).

**HTTP Status:** 504

**Error code:** `timeout`

**User-facing message:** "The analysis took too long. Please try again."

**Recovery:** "Try Again."

---

### FG-13 — Rate Limit (OpenAI)

**When:** OpenAI rate limit is exceeded.

**Detection:** `OpenAIAnalysisError` with `code: 'rate_limit'`.

**HTTP Status:** 429

**Error code:** `rate_limit`

**User-facing message:** "The analysis service is busy right now. Please wait a moment and try again."

**Recovery:** "Try Again" after a short delay. Consider showing a note: "Wait 30 seconds before retrying."

---

### FG-14 — Server Configuration Error

**When:** `ANALYSIS_MODE` is not set or is set to an invalid value; `OPENAI_API_KEY` is missing.

**Detection:** Server-side configuration check.

**HTTP Status:** 500

**Error code:** `server_error`

**User-facing message:** "The service is not configured correctly. Please contact support."

**Recovery:** No retry (configuration errors cannot be fixed by the user). "Contact support" link or note.

---

### FG-15 — localStorage Unavailable

**When:** `localStorage` is not accessible (e.g., private/incognito mode with storage blocked, storage quota exceeded).

**Detection:** Client-side, when `aiStyleProfileService.saveProfile()` throws.

**HTTP Status:** N/A (client-side error)

**User-facing message:** "Your profile was generated but couldn't be saved. Your browser's storage may be full or restricted."

**Recovery:** Suggest enabling storage or using a non-private browsing session. The profile cannot be persisted in this scenario.

---

## Failure States — Existing Analysis (Changes Only)

Phase 3 does not change the error handling of the existing `/api/analyze` endpoint for its core failure states. The only new failure case is:

### FA-01 — Malformed AI Profile in Analysis Request

**When:** The `aiStyleProfile` field in the `/api/analyze` request is present but fails JSON parse or Zod validation.

**Behavior:** Analysis proceeds without the AI profile context. A warning is logged server-side.

**HTTP Status:** Not affected (200 on success).

**User-facing behavior:** No error shown. Analysis completes normally.

**Rationale:** A corrupted `localStorage` value should never block outfit analysis. The AI profile is additive context, not a required precondition.

---

## Retry Behavior

### User-Initiated Retries
All retry actions are explicitly user-initiated. There are no automatic retries.

### "Try Again" Behavior
- Resubmits the same photo that was previously uploaded
- The photo file is retained in component state until the user explicitly selects a different one
- If the photo was cleared (e.g., user navigated away), "Try Again" returns to the upload step

### "Upload a Different Photo" Behavior
- Clears the current photo selection
- Returns to the upload step (drop zone / file picker)

### Retry Limit
No hard retry limit is enforced on the client. Rate limiting is enforced at the API level (FG-13). If the user hits rate limits, the message tells them to wait.

---

## Error Display Pattern

All errors in the AI Profile section follow the same visual pattern:

```
[AlertCircle icon]  [Error message]
                    [Next step text — smaller, muted]

[Try Again button]  [Upload a Different Photo button]
```

- Error message: `text-sm text-foreground`
- Next step text: `text-sm text-muted-foreground mt-1`
- Buttons: side by side on desktop, stacked on mobile
- Container: same card style as other states but with a `border-destructive/30` or `border-yellow-500/30` treatment

This pattern mirrors the existing `ErrorState` component (`components/fashion/ErrorState.tsx`) and should reuse or extend it.

---

## Error Logging

| Level | What is Logged |
|---|---|
| `console.error` | Raw AI response on schema validation failure |
| `console.warn` | Malformed `aiStyleProfile` in analysis request |
| `console.error` | Unexpected server errors with full error object |
| Never logged | User photos (binaries are never logged) |
| Never logged | User-identifiable personal information |

Structured server-side logging (beyond `console`) is a Phase 4+ concern when a proper logging infrastructure is in place.

---

## Error State Persistence

- The failure state (FG-06 through FG-14) is component state — it does not persist across page reloads
- On page reload, the UI returns to the empty state (if no profile) or the generated state (if a profile exists)
- This is intentional: a page reload is an implicit "start fresh" action

---

## Edge Case: Failure During Regeneration

If the user triggers regeneration and generation fails:

1. The existing stored profile is preserved (never deleted until a new one succeeds)
2. The failure state is shown in the AI Profile section
3. A note is shown: "Your previous profile is still active."
4. The user can retry with the same photo or upload a different one
5. Canceling the retry (navigating away) leaves the existing profile intact

This is the critical data-preservation guarantee: **a failed regeneration never results in the user having no profile.**
