# UI Specification — Phase 3

## Document Status
Specification — not yet implemented.

---

## Design Language

Phase 3 UI follows the established Verdict design system. All new UI must be indistinguishable from the existing profile page in terms of visual language.

**Design references:**
- Dark theme, minimal, Apple / Linear inspired
- Quiet and confident — not colorful, not gimmicky
- Typography: system font stack (`-apple-system`, `Segoe UI`, sans-serif equivalent via Tailwind)
- Color tokens: use existing Tailwind/shadcn tokens (`bg-card`, `text-foreground`, `text-muted-foreground`, `border-border`, `bg-primary/10`, `text-primary`)
- Animations: Framer Motion only, subtle `fadeUp` and `staggerContainer` patterns (same as existing profile page)
- Component library: shadcn/ui (existing components only; add new ones only if no existing component serves the use case)

---

## Profile Page Layout (Extended)

### Overall Structure

The Profile page (`/dashboard/profile`) is a single-column layout with `max-w-3xl mx-auto`. The page now has three logical sections stacked vertically:

1. Page Header (existing, extended)
2. AI Style Profile Section (new)
3. Style Preferences Section (existing, unchanged)

A visual divider (`<Separator />` or a `border-t border-border` rule) separates the AI Profile section from the Style Preferences section.

---

## Section 1 — Page Header (Extended)

**Existing elements (unchanged):**
- Page title: "Style Profile"
- Subtitle: "A quick snapshot of your taste. Nothing here is required — save whenever you are ready."
- Completion progress bar

**Extension:**
The completion progress bar is extended from 3 sections to 4 sections:
- Section 1: AI Style Profile (is it generated?)
- Section 2: Preferred styles (has at least one selection?)
- Section 3: Favorite colors (has at least one selection?)
- Section 4: Occasion preferences (has at least one selection?)

The percentage is `completedSections / 4 * 100`. The visual component is unchanged.

---

## Section 2 — AI Style Profile Section (New)

This section has four distinct visual states. Only one is displayed at a time.

---

### State A — Empty State

Shown when no AI Style Profile exists and generation is not in progress.

**Container:** `rounded-2xl border border-border bg-card p-6` (same as existing preference cards)

**Layout:**
```
[Icon or subtle illustration — optional]
[Headline]
[Description]
[CTA Button]
```

**Content:**
- Headline: "AI Style Profile" — `font-medium text-foreground`
- Subheadline/description: "Generate a personalized style profile from your photo. It improves every outfit analysis." — `text-sm text-muted-foreground mt-1`
- Button: "Generate Profile" — primary button, `size="default"`

**Photo Upload Area** (rendered below the card when user clicks "Generate Profile"):
- The card does not navigate away; the upload area is revealed inline below the CTA
- Upload area: dashed border, centered icon, instruction text, click-to-browse and drag-and-drop
- Instruction text: "Upload a clear photo of yourself. Face and upper body visible. Good lighting recommended."
- Accepted formats note: "JPEG, PNG, WEBP · Max 10MB"
- Below upload area: "Cancel" link (text style, not button) to collapse back to empty state

**After photo selection:**
- Upload area is replaced by a photo preview + confirmation controls
- Photo preview: rounded thumbnail (approximately 80×80px or 120×120px, constrained, `object-cover`)
- Privacy note below thumbnail: "Your photo is analyzed by AI and not stored on our servers." — `text-xs text-muted-foreground`
- Confirm button: "Analyze Photo" — primary button
- Alternative action: "Choose a different photo" — text link style

**Inline validation error (if photo fails client-side check):**
- Shown below the upload area in red/destructive styling
- Example: "Image must be at least 512×512 pixels. Please choose a different photo."
- Error clears when a new photo is selected

---

### State B — Loading State

Shown from the moment the user confirms photo upload until the AI responds.

**Container:** Same `rounded-2xl border border-border bg-card p-6` as the empty state.

**Layout:**
```
[Spinner]
[Status text]
```

**Content:**
- Spinner: the existing Framer Motion spinner pattern from `LoadingAnalysis` component, adapted with smaller sizing
- Status text: "Analyzing your style..." — `text-sm text-muted-foreground`, centered
- No cancel option during active AI call
- The rest of the page (manual preferences section below) remains visible and interactive

---

### State C — Generated State

Shown when a valid `AIStyleProfile` exists in storage.

**Container:** `rounded-2xl border border-border bg-card` — same card shell.

**Header within card:**
- Left: "AI Style Profile" — `font-medium text-foreground`
- Right: secondary actions row — "Regenerate" (outline button, small) and "Delete" (ghost button, small, destructive color)
- Both action buttons must be visually quieter than primary save actions

**Profile Content Layout:**

The profile is displayed in a grid of sub-cards or sections within the main card. Each sub-section corresponds to a major schema section.

**Sub-section: Style Keywords (displayed first, most human-readable)**
- Heading: "Style" — `text-sm font-medium text-muted-foreground uppercase tracking-wide`
- Content: pill tags (same style as existing style preference chips but read-only — no hover/toggle behavior)
- Each pill shows the keyword and a confidence indicator (subtle — e.g., medium opacity if `Medium` or `Low` confidence)
- Layout: flex wrap gap-2

**Sub-section: Coloring**
- Heading: "Coloring" — same heading style
- Content: two-column label/value grid
  - Skin tone: depth + undertone (e.g., "Medium · Warm")
  - Hair: `hair_color` value (e.g., "Dark Brown")
  - Contrast: High / Low (derived from `high_contrast` boolean)
- `null` values: shown as "—" (em dash), not hidden
- Confidence: shown as a small badge below the section if `Medium` or `Low`

**Sub-section: Proportions**
- Heading: "Proportions"
- Content: label/value pairs for `frame_width`, `torso_length`, `shoulder_breadth`
- Null handling: same as coloring (em dash)
- Confidence indicator: same pattern

**Sub-section: Current Style Signals**
- Heading: "Observed Style"
- Content: `current_outfit_formality` and `current_outfit_style` from `aesthetic_signals`
- Display: human-readable sentence or label/value grid

**Sub-section: Analysis Notes**
- Heading: "Analysis Notes" — smaller, visually quieter
- Content: `analysis_notes.confidence_summary` — `text-sm text-muted-foreground`
- If `visibility_limitations` is non-empty: show as a small note — "Note: [limitation 1], [limitation 2]"

---

### State D — Failure State

Shown when generation was attempted and failed.

**Container:** Same card shell, but border may use destructive/warning color token — `border-destructive/30` or `border-yellow-500/30`.

**Content:**
- Error icon (small, using lucide-react — `AlertCircle` or similar)
- Error message: specific (from `10_ERROR_HANDLING.md`)
- Action row:
  - "Try Again" — primary button (resubmits same photo)
  - "Upload a Different Photo" — outline button (resets to upload step)
- If a previous profile exists and was preserved: a note below the actions — "Your previous profile is still active." with the profile shown below in collapsed form or as a brief summary

---

## Section 3 — Style Preferences Section (Unchanged)

The existing three sub-sections (Preferred Style, Favorite Colors, Occasion Preferences) are unchanged in behavior, layout, and logic. They are separated from the AI Profile section by a divider.

The section heading is unchanged: no "manual" or "legacy" label is added. These are simply the user's stated preferences.

---

## Confirmation Dialogs

### Regenerate Confirmation
- Component: `Dialog` from `components/ui/dialog.jsx`
- Title: "Regenerate AI Style Profile?"
- Body: "This will replace your current profile. Your manually saved style preferences will not be affected."
- Primary button: "Regenerate" — standard button
- Secondary button: "Keep Current" — outline/ghost
- Closing behavior: clicking outside or pressing Escape = keep current (no action)

### Delete Confirmation
- Component: `Dialog`
- Title: "Delete AI Style Profile?"
- Body: "Your profile data will be removed from this device. This cannot be undone. Your manually saved style preferences will not be affected."
- Primary button: "Delete Profile" — destructive styling (`variant="destructive"`)
- Secondary button: "Cancel" — outline/ghost
- Closing behavior: clicking outside or pressing Escape = cancel (no action)

---

## Analysis Page — Profile Presence Indicator (New)

When an AI Style Profile exists, the Analysis page shows a subtle indicator in the header area:

- Small icon + label: "AI Profile Active" — `text-xs text-muted-foreground`, no prominent styling
- This is informational only; it has no interactive behavior
- It is positioned near the other contextual information (occasion selector, style profile notes)

### Soft Prompt (No Profile)

When no AI Style Profile exists and the user has not dismissed the prompt:

- Shown as a subtle inline card or banner — NOT a modal, NOT a blocking step
- Text: "Generate your AI Style Profile for more accurate results." with a link to `/dashboard/profile`
- A dismiss (×) icon closes the prompt permanently
- Visual style: muted, informational — `bg-card border border-border` with small text

---

## Responsive Behavior

**Desktop (≥ 768px):**
- Profile content sub-sections: 2-column grid (`grid-cols-2 gap-4`)
- Style keywords: flex wrap (already responsive by nature)

**Mobile (< 768px):**
- Profile content sub-sections: single column (`grid-cols-1`)
- Action buttons (Regenerate/Delete): full width or flex-wrap
- Photo upload area: full width, centered

No horizontal scrolling at any breakpoint.

---

## Dark Mode

All new UI uses existing Tailwind/shadcn semantic tokens which are dark-mode aware. No hardcoded colors. No `dark:` variants needed if semantic tokens are used correctly.

---

## Accessibility

- All interactive elements have accessible names via `aria-label` or visible text
- Confirmation dialogs use `Dialog` which handles focus trapping and Escape key natively
- Upload area supports keyboard interaction (Tab to focus, Enter/Space to activate)
- Toggle/chip buttons use `aria-pressed` (same pattern as existing style preference chips)
- Error messages are associated with their input fields via `aria-describedby` or proximity
- Loading state uses `aria-live="polite"` region or `role="status"` for screen reader announcements
- Profile content is structured with appropriate semantic headings (`<h3>`, `<h4>`)
- Color alone is never the only differentiator for state (e.g., error states use both color and icon)
- All interactive elements meet minimum 44×44px touch target size on mobile

---

## Empty State Design (Summary)

| State | Card Treatment | Primary Action | Secondary Action |
|---|---|---|---|
| No AI profile | Standard card, dashed upload area | "Generate Profile" | — |
| Generating | Standard card, centered loader | — | — |
| Profile exists | Standard card, structured content | — | "Regenerate" (outline), "Delete" (ghost) |
| Generation failed | Warning-tinted card, error message | "Try Again" | "Upload a Different Photo" |

---

## Component Names (Tentative)

New components to be created during implementation:

| Component | Location | Purpose |
|---|---|---|
| `AIStyleProfileSection` | `components/fashion/` | Main section container; manages display state |
| `AIProfileCard` | `components/fashion/` | Displays the structured profile fields |
| `ProfileGenerationUpload` | `components/fashion/` | Photo upload + confirmation step for profile generation |
| `ProfileGenerationLoader` | `components/fashion/` | Loading state (may wrap existing `LoadingAnalysis`) |
| `ProfileGenerationError` | `components/fashion/` | Failure state display |
| `RegenerateConfirmDialog` | `components/fashion/` | Confirmation dialog for regeneration |
| `DeleteProfileConfirmDialog` | `components/fashion/` | Confirmation dialog for deletion |

All new components follow the existing file naming and organization conventions.
