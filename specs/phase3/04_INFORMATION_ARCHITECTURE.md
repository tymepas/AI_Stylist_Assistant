# Information Architecture — Phase 3

## Document Status
Specification — not yet implemented.

---

## Navigation Structure

The existing navigation is unchanged. Phase 3 does not add new top-level routes.

```
/dashboard                        (Dashboard home)
  /dashboard/analysis             (Outfit analysis workflow)
  /dashboard/profile              (Style profile — extended in Phase 3)
  /dashboard/history              (Placeholder — Phase 4)
  /dashboard/settings             (Placeholder)
```

All Phase 3 features live within `/dashboard/profile`. No new routes are required.

---

## Page Hierarchy

### `/dashboard/profile` — Profile Page (Extended)

**Before Phase 3:**
- Single section: Style Preferences (manual entry of preferred styles, colors, occasions)

**After Phase 3:**
- Section 1: AI Style Profile (new — AI-generated, displayed read-only)
- Section 2: Style Preferences (existing — manually entered, fully editable, unchanged)

The two sections are visually separated by a clear divider or heading. They are independent data stores with independent save/delete actions.

**Page owns:**
- AI Style Profile state (read from `localStorage`, triggers generation flow)
- Manual profile state (existing behavior, unchanged)
- Profile completion meter (extended to include AI profile as a section)

---

## Component Hierarchy

### Profile Page (`app/dashboard/profile/page.tsx`)

```
ProfilePage
├── PageHeader
│   ├── Title: "Style Profile"
│   └── ProfileCompletionMeter (extended to include AI profile section)
│
├── AIStyleProfileSection (new)
│   ├── [Empty State]
│   │   ├── EmptyStateCard
│   │   │   ├── Icon / illustration
│   │   │   ├── Headline + description
│   │   │   └── GenerateProfileButton
│   │   └── PhotoUploadArea (conditionally rendered on button click)
│   │       ├── DropZone
│   │       ├── PhotoPreview (after selection)
│   │       ├── ValidationError (inline)
│   │       └── ConfirmUploadButton
│   │
│   ├── [Loading State]
│   │   └── ProfileGenerationLoader
│   │       ├── Spinner / animation
│   │       └── StatusText: "Analyzing your style..."
│   │
│   ├── [Generated State]
│   │   ├── AIProfileCard
│   │   │   ├── ColoringSection
│   │   │   ├── ProportionsSection
│   │   │   ├── AestheticSignalsSection
│   │   │   ├── StyleKeywordsSection
│   │   │   └── ContextNotesSection
│   │   └── ProfileActions
│   │       ├── RegenerateButton
│   │       └── DeleteButton
│   │
│   └── [Failure State]
│       ├── ErrorCard
│       │   ├── ErrorMessage
│       │   ├── TryAgainButton
│       │   └── UploadDifferentPhotoButton
│       └── (ExistingProfileCard if a previous profile existed)
│
├── Divider
│
└── ManualStylePreferencesSection (existing, unchanged)
    ├── PreferredStylePicker
    ├── FavoriteColorPicker
    ├── OccasionPreferencePicker
    └── SaveProfileButton
```

### Shared Components (reused, not duplicated)

| Component | Location | Usage in Phase 3 |
|---|---|---|
| `UploadCard` | `components/fashion/UploadCard.tsx` | Reused for photo upload in profile generation |
| `ErrorState` | `components/fashion/ErrorState.tsx` | Reused for generation failure display |
| `LoadingAnalysis` | `components/fashion/LoadingAnalysis.tsx` | Reused or adapted for profile generation loading |
| `Button` | `components/ui/button.jsx` | All actions |
| `Card` | `components/ui/card.jsx` | Profile section container |
| Dialog (confirm) | `components/ui/dialog.jsx` | Regenerate and Delete confirmations |

New components are created only when no existing component covers the use case:
- `AIProfileCard` — displays the structured profile fields in a readable layout
- `ProfileGenerationLoader` — may reuse `LoadingAnalysis` with different text, or be a thin wrapper

---

## Data Ownership

### AI Style Profile
- **Owner:** `localStorage` key `verdict_ai_style_profile`
- **Read by:** Profile page (display), Analysis page (context injection), API route (forwarded to AI)
- **Written by:** Profile generation flow (post-validation only)
- **Deleted by:** Profile deletion flow (explicit user action)
- **Type:** `AIStyleProfile` (new type, defined in `types/schema.ts`)

### Manual Style Profile
- **Owner:** `localStorage` key `verdict_style_profile`
- **Read by:** Profile page (display and editing), Analysis page (context injection)
- **Written by:** Manual profile save action (existing behavior)
- **Deleted by:** Not yet exposed to users (Phase 4 concern)
- **Type:** `StyleProfile` (existing type, unchanged)

### Profile Completion Meter
- **Owner:** Computed value — no storage
- **Reads from:** Both `AIStyleProfile` (is it present?) and `StyleProfile` (how many sections completed?)
- **Computed by:** `getProfileCompletion()` — extended to include AI profile section
- **Logic:** 4 total sections (AI profile, preferred styles, favorite colors, occasion preferences). Percent = completed / 4.

### Analysis Soft Prompt Dismissal
- **Owner:** `localStorage` key `verdict_profile_prompt_dismissed`
- **Read by:** Analysis page
- **Written by:** User dismissing the prompt
- **Type:** boolean (stored as string `"true"`)

---

## API Data Flow

### Profile Generation
```
Client (profile page)
  → POST /api/generate-profile
    → multipart: { photo: File }
  ← JSON: AIStyleProfile | GenerationFailureResponse

Client validates response schema
  → if valid: write to localStorage[verdict_ai_style_profile]
  → if invalid: show failure state
```

### Outfit Analysis with AI Profile
```
Client (analysis page)
  → reads localStorage[verdict_ai_style_profile]
  → reads localStorage[verdict_style_profile]
  → POST /api/analyze
    → multipart: {
        photo: File,
        garment: File,
        occasion: string,
        styleProfile: JSON (existing manual profile),
        aiStyleProfile: JSON (new AI-generated profile — optional)
      }
  ← JSON: CompleteAnalysisResult | UnableToAnalyzeResult (unchanged shape)
```

The `/api/analyze` response shape is unchanged. The AI profile is additional input, not additional output.

---

## Shared Data Contracts

### New Types (additions to `types/schema.ts`)
- `AIStyleProfile` — the full AI-generated profile schema
- `AIStyleProfileStatus` — `'not_generated' | 'generating' | 'complete' | 'failed'`
- `ProfileGenerationFailureReason` — enumeration of failure causes

### Unchanged Types
- `StyleProfile` — manual preferences, unchanged
- `AnalysisResult`, `CompleteAnalysisResult`, `UnableToAnalyzeResult` — analysis output, unchanged
- `AnalyzeRequestPayload` — extended with optional `aiStyleProfile` field; existing fields unchanged

---

## Future Extensibility

### Phase 4 — Wardrobe Memory
The Profile page will gain a third section: Wardrobe. The information architecture supports this without restructuring — it is an additive section below the existing two.

The `AIStyleProfile` schema is designed to carry fields that are directly useful to wardrobe cohesion analysis. No schema redesign should be required in Phase 4.

### Phase 4 — Cloud Persistence
When authentication is introduced, both the AI Style Profile and the Manual Profile will need migration from `localStorage` to a user-associated cloud store. The storage abstraction in `styleProfileService.ts` should be extended to support a cloud adapter behind the same interface. The UI layer should not need to change.

### Phase 5 — Virtual Try-On
The `AIStyleProfile` captures proportions and coloring in a form that can be passed to a Try-On rendering service. No schema changes are anticipated, but additional fields (e.g., body silhouette descriptors) may be added in Phase 5.

### Profile Versioning
The `AIStyleProfile` includes a `schema_version` field from Phase 3. This enables future migrations without breaking existing stored profiles. See `08_STORAGE_SPECIFICATION.md` for the versioning strategy.
