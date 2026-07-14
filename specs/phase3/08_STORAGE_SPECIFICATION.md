# Storage Specification — Phase 3

## Document Status
Specification — not yet implemented.

---

## Storage Architecture Overview

Phase 3 uses the same storage layer as Phases 1 and 2: browser `localStorage`. No server-side storage, no cloud storage, no database is introduced. This is consistent with the existing architecture and the constraints of a pre-authentication product.

There are two distinct profiles stored in `localStorage`:

| Key | Type | Introduced |
|---|---|---|
| `verdict_style_profile` | `StyleProfile` (manual) | Phase 1 |
| `verdict_ai_style_profile` | `AIStyleProfile` (AI-generated) | Phase 3 |

These are independent. Deleting one does not affect the other. Writing one does not affect the other.

---

## What Is Stored

### `verdict_style_profile` (Existing — Unchanged)

```
{
  preferredStyles: string[],
  favoriteColors: string[],
  occasionPreferences: string[]
}
```

Stored as a JSON string. Written by `saveProfile()` in `lib/services/styleProfileService.ts`. Read by the Profile page and the Analysis page. This storage contract is unchanged.

---

### `verdict_ai_style_profile` (New)

Stores the complete `AIStyleProfile` object as returned by the `/api/generate-profile` endpoint (after the application sets `generated_at_utc`).

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

Only a `status: "complete"` profile is ever written to storage. If generation fails, nothing is written (or, if a prior profile exists, it is preserved).

Stored as a JSON string. Maximum expected size: approximately 2–3 KB. This is well within localStorage limits.

---

### `verdict_profile_prompt_dismissed` (New)

Stores whether the user has dismissed the soft prompt on the Analysis page suggesting they generate a profile.

```
"true"
```

Stored as a plain string. Written when the user clicks "Dismiss" on the analysis page prompt. Never deleted (dismissal is permanent across sessions).

---

## What Is Temporary (Not Stored)

| Data | Lifetime | Why Not Stored |
|---|---|---|
| User photo submitted for profile generation | Request lifetime only | Privacy; only the structured output is valuable |
| Raw AI response before schema validation | Request lifetime only | Never stored if invalid; replaced by validated object |
| Analysis photos (personal photo, garment) | Request lifetime only | Existing behavior, unchanged |
| Loading state | Component state | Ephemeral UI state |
| Error messages | Component state | Not persisted; recoverable on retry |

---

## What Can Be Regenerated

The `AIStyleProfile` is fully regenerable from a new photo at any time. It has no dependency on data that cannot be recreated.

If a stored profile is detected as invalid (schema version mismatch, corrupt JSON), the storage service should:
1. Delete the invalid stored value
2. Return `null` (same as no profile)
3. The Profile page will then show the empty state with a "Generate Profile" CTA

This means the user loses their stored profile in this scenario but can immediately regenerate it. No permanent data loss occurs because the profile is derived from observable reality (a photo), not from information the user typed.

---

## Profile Lifecycle

### Creation
1. User uploads photo on Profile page
2. Client sends photo to `POST /api/generate-profile`
3. Server validates, calls AI, validates response
4. Server returns validated `AIStyleProfile`
5. Client receives response
6. Client validates schema client-side (defensive check)
7. Client writes to `localStorage[verdict_ai_style_profile]`
8. Profile page displays the new profile

### Reading
- On Profile page load: `aiStyleProfileService.getProfile()` reads from localStorage
- On Analysis page load: same read
- If localStorage is unavailable: return `null` (same as no profile; graceful degradation)
- If stored value is corrupt JSON: return `null` after attempting to clear the corrupt value

### Updating (Regeneration)
1. User confirms regeneration
2. New photo is uploaded and generation succeeds
3. New profile overwrites the existing stored value atomically
4. If generation fails, the old stored value is preserved (no partial update)

Atomicity note: `localStorage.setItem()` is synchronous and effectively atomic for the purposes of this application. The write either completes or it does not. There is no partial-write risk.

### Deletion
1. User confirms deletion via dialog
2. `aiStyleProfileService.clearProfile()` calls `localStorage.removeItem(verdict_ai_style_profile)`
3. Profile page reflects empty state

---

## Profile Versioning

The `schema_version` field (e.g., `"1.0"`) is written into every stored profile and verified on read.

### Version Check Logic
```
on read:
  parse stored JSON
  if schema_version !== currentSchemaVersion:
    log "stored profile is version X, current schema is Y"
    delete stored profile
    return null
  return parsed profile
```

### When to Increment the Version
- When a required field is added (a stored profile would be missing it)
- When an existing field's type changes
- When allowed enum values change in a way that makes old values invalid

Do NOT increment for:
- Adding optional fields with `null` defaults (old stored profiles still pass validation because new fields have defaults)
- Changing human-readable strings that do not affect logic

### Version History

| Version | Changes |
|---|---|
| 1.0 | Initial Phase 3 schema |

Future versions are added here with date and reason.

---

## Migration Strategy

### Phase 3 → Phase 4 (Cloud Persistence)

When Phase 4 introduces user authentication and cloud storage:

1. The `aiStyleProfileService` is extended to support both a localStorage adapter and a cloud adapter
2. On first authenticated login, the client migrates any existing localStorage profile to cloud storage
3. The cloud schema matches the localStorage schema exactly — no conversion required
4. After successful cloud migration, the localStorage copy is deleted
5. Subsequent reads/writes go through the cloud adapter

The service interface is designed to abstract the storage medium:
```
aiStyleProfileService.getProfile() → AIStyleProfile | null
aiStyleProfileService.saveProfile(profile) → void
aiStyleProfileService.clearProfile() → void
```

The UI layer and the API layer should not need to change when the storage adapter changes.

### Schema Version Upgrade Migration

If a schema version upgrade is required between phases:

1. Bump `CURRENT_SCHEMA_VERSION` in the storage service
2. On read, if stored version < current version:
   - If the delta is addable (new optional fields only): attempt in-place upgrade by adding default values
   - If the delta is breaking (required fields changed): delete and return `null`
3. Profile page shows "Your profile needs to be regenerated" note in the empty state if a schema upgrade triggered deletion

---

## Service Module Design

A new service module `lib/services/aiStyleProfileService.ts` (name tentative; mirrors `styleProfileService.ts`) should expose:

```
STORAGE_KEY: 'verdict_ai_style_profile'
CURRENT_SCHEMA_VERSION: '1.0'

getProfile(): AIStyleProfile | null
  - reads localStorage
  - parses JSON
  - validates schema_version
  - validates structure (Zod)
  - returns null on any failure (with appropriate cleanup)

saveProfile(profile: AIStyleProfile): void
  - validates schema_version === CURRENT_SCHEMA_VERSION
  - writes JSON to localStorage

clearProfile(): void
  - removes item from localStorage

isProfileComplete(profile: AIStyleProfile | null): boolean
  - returns true if profile exists and status === 'complete'
```

This mirrors the interface of `styleProfileService.ts` to maintain consistency.

---

## Future Compatibility Notes

### Phase 4 — Wardrobe Items
Wardrobe items will be stored under a separate key (e.g., `verdict_wardrobe`). They are not co-located with the AI Style Profile. The profile schema has a reserved `wardrobe_context` section that carries profile-level wardrobe notes but does not store individual wardrobe items.

### Phase 4 — Profile History
Future phases may want to keep a history of previous profiles (e.g., to show how the user's style evolved). In Phase 3, there is no history. The implementation should not build history infrastructure, but the service interface should be designed so that a history adapter can be substituted without changing the primary interface.

### Phase 5 — Virtual Try-On
The stored `AIStyleProfile` is the exact input the Try-On service will need. No schema changes are anticipated, but the `proportions` section may be extended with additional fields if the Try-On service requires them. The Phase 3 schema reserves space for this by using nullable optional fields.
