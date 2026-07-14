# API Specification — Phase 3

## Document Status
Specification — not yet implemented.

---

## Design Principles

1. **Additive only.** Phase 3 adds one new endpoint and one optional field to the existing `/api/analyze` payload. No existing endpoint is modified in a breaking way.
2. **Consistent with existing patterns.** The new endpoint follows the same structure as `/api/analyze`: multipart form data, JSON response, Zod validation, `ANALYSIS_MODE` environment variable, CORS handling.
3. **No authentication.** Phase 3 does not introduce authentication. All requests are anonymous. This is consistent with the existing architecture.
4. **Schema-validated responses only.** The AI's raw response is never returned to the client. Only schema-validated, application-constructed responses are returned.

---

## Existing Endpoint — Changes

### `POST /api/analyze`

**Status:** Extended. No breaking changes.

**Change:** The request payload accepts one new optional field: `aiStyleProfile`. The response shape is unchanged.

#### Request (Extended)

Content-Type: `multipart/form-data`

| Field | Type | Required | Change |
|---|---|---|---|
| `photo` | File | Yes | Unchanged |
| `garment` | File | Yes | Unchanged |
| `occasion` | string | Yes | Unchanged |
| `styleProfile` | string (JSON) | No | Unchanged |
| `aiStyleProfile` | string (JSON) | No | **New — optional** |

#### `aiStyleProfile` Field Behavior
- If absent or empty: analysis proceeds without AI profile context (existing behavior preserved)
- If present: parsed, validated against `AIStyleProfile` schema, and included in the AI prompt context
- If malformed JSON or schema-invalid: analysis proceeds without AI profile context and logs a warning; it does NOT return a 400 error (graceful degradation)
  - Rationale: a corrupted localStorage value should not block outfit analysis
- The application-level parsing logic follows the same pattern as the existing `styleProfile` parsing in `parseStyleProfile()`

#### Response
Unchanged. See `AI_OUTPUT_SCHEMA.md`.

---

## New Endpoint

### `POST /api/generate-profile`

Accepts a single user photo and returns an AI-generated `AIStyleProfile` or a failure object.

#### Request

Content-Type: `multipart/form-data`

| Field | Type | Required | Constraints |
|---|---|---|---|
| `photo` | File | Yes | JPEG, PNG, WEBP; max 10MB; min 512×512 px |

No other fields are required. Occasion and garment are not relevant to profile generation.

#### Validation (server-side, before AI call)

1. `photo` field must be present and must be an uploaded file (not a string)
2. File type must be `image/jpeg`, `image/png`, or `image/webp`
3. File size must be > 0 and ≤ 10MB
4. File must be a valid image (byte-level format validation using the existing `validateImageFile()` function)
5. Image dimensions must be ≥ 512×512 px

All validation failures return 400 with a structured error response (see Error Responses below).

#### AI Call

- Model: same as `/api/analyze` (controlled by `ANALYSIS_MODE` environment variable)
- Mode: `openai` uses GPT-4.1 Vision; `mock` returns a canned valid `AIStyleProfile`
- System prompt: loaded from `memory/STYLE_PROFILE_SYSTEM_PROMPT.md` (new file, authored in implementation phase)
- Input to AI: single image (user photo)
- Expected output: JSON conforming to `AIStyleProfile` schema
- Timeout: 30 seconds (longer than analysis because profile generation is more thorough)

#### Schema Validation (server-side, after AI call)

The AI response is parsed and validated using Zod against the `AIStyleProfile` schema.

- If validation passes: `generated_at_utc` is set by the application (not the AI), and the complete object is returned
- If validation fails: return `unable_to_generate` response; log the raw AI output for debugging

#### Success Response

HTTP 200

```json
{
  "schema_version": "1.0",
  "generated_at_utc": "2025-01-15T14:32:00Z",
  "status": "complete",
  "coloring": { ... },
  "proportions": { ... },
  "aesthetic_signals": { ... },
  "style_keywords": [ ... ],
  "wardrobe_context": { ... },
  "analysis_notes": { ... }
}
```

#### Unable to Generate Response

HTTP 200 (not 4xx — the request was valid; the AI could not produce a profile from the photo)

```json
{
  "schema_version": "1.0",
  "status": "unable_to_generate",
  "reason": "No person detected in the uploaded photo.",
  "next_step": "Upload a clear photo showing your face and upper body.",
  "confidence": "Low"
}
```

---

## Error Responses

All error responses follow the existing pattern from `/api/analyze`:

```json
{
  "error": "<error_code>",
  "message": "<human-readable message>"
}
```

### Error Codes for `POST /api/generate-profile`

| HTTP Status | `error` value | When |
|---|---|---|
| 400 | `missing_image` | `photo` field is absent or is not a file |
| 400 | `invalid_upload` | File type, size, or format validation fails; includes specific message |
| 429 | `rate_limit` | OpenAI rate limit exceeded |
| 500 | `server_error` | `ANALYSIS_MODE` is misconfigured; unexpected server error |
| 502 | `api_error` | OpenAI API error or invalid response that fails schema validation |
| 504 | `timeout` | AI call exceeded 30-second timeout |

### Error Codes for `POST /api/analyze` (new field only)

The new `aiStyleProfile` field does not introduce new error codes. Malformed AI profile data causes graceful degradation (analysis continues without profile), not an error response.

---

## Status Codes

| Code | Meaning |
|---|---|
| 200 | Success (including `unable_to_generate` — request was valid) |
| 400 | Client error — invalid request |
| 429 | Rate limited |
| 500 | Server configuration error |
| 502 | External service error (OpenAI) |
| 504 | Timeout |

This matches the existing status code set used by `/api/analyze`.

---

## Authentication

Phase 3 introduces no authentication. All endpoints are anonymous.

The existing `CORS_ORIGINS` environment variable governs CORS behavior. No change required.

---

## Environment Variables

| Variable | Existing/New | Purpose |
|---|---|---|
| `ANALYSIS_MODE` | Existing | Controls `mock` vs `openai` mode for both endpoints |
| `OPENAI_API_KEY` | Existing | Used by profile generation in `openai` mode |
| `CORS_ORIGINS` | Existing | CORS allow-list |

No new environment variables are required.

---

## Mock Mode

When `ANALYSIS_MODE=mock`:

- `/api/generate-profile` returns a canned valid `AIStyleProfile` after a simulated delay (1.5–2.5 seconds)
- The mock profile should cover all sections with realistic but clearly mock data
- It should not contain real person data
- Mock rotates between two scenarios: full profile (all fields populated) and a partial profile (some `null` fields to test display)

---

## Request / Response Flow Summary

```
POST /api/generate-profile
  → multipart validation (photo presence, type, size)
  → byte-level image validation (format + dimensions)
  → ANALYSIS_MODE check
  → mock: return canned AIStyleProfile after delay
  → openai:
      → AI call (single photo, profile generation system prompt)
      → Zod schema validation
      → if valid: append generated_at_utc, return AIStyleProfile
      → if invalid: return unable_to_generate + log raw
  → error states: structured error JSON + appropriate HTTP status
```

```
POST /api/analyze (extended)
  → existing validation (photo, garment, occasion) — unchanged
  → parseStyleProfile() — unchanged
  → parseAIStyleProfile() — NEW: parse optional aiStyleProfile field
    → if missing/empty: proceed without it
    → if malformed: log warning, proceed without it
    → if valid: include in OpenAI context
  → existing analysis flow — unchanged
  → response — unchanged
```

---

## Future Compatibility

### Phase 4 — Wardrobe Items
Wardrobe Memory will likely introduce a `POST /api/add-wardrobe-item` endpoint that also accepts a photo. The pattern established by `POST /api/generate-profile` (single photo → AI analysis → schema-validated JSON → localStorage) can be directly reused.

### Phase 4 — Profile Persistence
When authentication is introduced, both endpoints will need to accept a user token and route storage through a database. The API surface (request/response shape) should not change; only the storage layer changes.

### Phase 5 — Virtual Try-On
Virtual Try-On will likely require sending both the user's AI Style Profile and a garment image to a rendering service. The profile generated by `POST /api/generate-profile` is the exact input required.

### Versioning
The `schema_version` field in the response ensures that clients can detect when a stored profile needs to be re-generated due to a schema version upgrade. The client-side service layer should reject stored profiles with an unknown `schema_version` and prompt regeneration.
