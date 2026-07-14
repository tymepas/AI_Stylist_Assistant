# Phase 3 Overview

## Document Status
Specification — not yet implemented.

---

## Why Phase 3 Exists

Phases 1 and 2 delivered a single-session outfit analysis engine. The user uploads photos, selects an occasion, and receives a structured verdict. Each session is stateless — the AI has no memory of who the user is, what they like, or what they have worn before.

This works well for one-off decisions. It does not scale to the product's actual ambition.

The core promise of Verdict is *Know before you buy*. That promise deepens enormously when the AI understands the user's styling identity across time. A first-time analysis knows only what it can observe in two photos. A tenth analysis, powered by a persistent Style Profile, can evaluate pattern consistency, wardrobe cohesion, and cross-occasion versatility in ways a single session cannot.

Phase 3 introduces the **AI Style Profile**: a persistent, AI-generated representation of the user's styling identity. It is generated once from an onboarding photo and reused as context in all future outfit analyses.

---

## Product Objectives

1. **Generate a reusable style identity** — The AI extracts observable, styling-relevant attributes from the user's photo. The result is stored and injected into every subsequent outfit analysis as richer context than the current `StyleProfile` (which is manually entered and only covers preferred styles, colors, and occasion preferences).

2. **Improve outfit analysis quality** — Analysis accuracy on the `style_preference_match` and `color` dimensions increases when the AI has reliable information about the user's actual coloring, proportions, and established aesthetic signals.

3. **Enable future personalization features** — The AI Style Profile becomes the foundation on which Shopping Recommendations (Phase 3), Wardrobe Memory (Phase 4), and Virtual Try-On (Phase 5) are built.

4. **Replace manual preference entry with observed reality** — The current manual profile is a crude proxy. Users often select preferences that reflect aspiration rather than their actual wardrobe. An AI-generated profile captures observable reality.

---

## User Value

| User Need | How Phase 3 Addresses It |
|---|---|
| "The recommendations feel generic" | The AI now knows the user's actual coloring and style signals |
| "I have to re-explain my style every time" | Profile is generated once, reused in every analysis |
| "I don't know what style words apply to me" | AI observes and labels it — user doesn't have to self-categorize |
| "The color recommendation doesn't feel personal" | Color analysis is grounded in the user's actual coloring |

---

## Business Value

- Increases session depth — users who complete profiling are more likely to run multiple analyses
- Creates a personalization layer that differentiates Verdict from generic chatbot fashion tools
- Produces a data asset (the Style Profile) that directly powers Phase 3 Shopping and Phase 4 Wardrobe Memory without additional AI calls
- Reduces friction at analysis time — no manual preference entry required once the profile exists

---

## Relationship to Future Phases

### Phase 3 — Shopping Recommendations
The AI Style Profile provides the user context required to match shopping recommendations to personal coloring, body proportions, and aesthetic preferences. Without the Style Profile, shopping recommendations would be occasion-driven only and no more personalized than a generic retailer filter.

The Style Profile is a **prerequisite** for meaningful shopping recommendations. It must exist before a shopping-oriented analysis can be trusted.

### Phase 4 — Wardrobe Memory
Wardrobe Memory requires understanding the user's existing wardrobe so the AI can evaluate new purchases for gap-filling and cohesion. The Style Profile provides the baseline aesthetic identity against which wardrobe items are measured. Without it, wardrobe cohesion analysis lacks a reference point.

### Phase 5 — Virtual Try-On
Virtual Try-On renders a garment on the user's body. The Style Profile captures the proportions, coloring, and fit signals that ground the Try-On in reality. It also informs the styling commentary that accompanies the Try-On image.

---

## What Phase 3 Does NOT Build

Phase 3 builds only the AI Style Profile generation and storage infrastructure. It does not build:

- Shopping recommendation UI or logic (Phase 3 shopping features are a separate milestone)
- Wardrobe item management (Phase 4)
- Virtual Try-On rendering (Phase 5)
- User authentication or accounts
- Cloud storage for photos
- Cross-device sync

The profile is generated client-side and stored locally in the same storage layer as the existing manual `StyleProfile`. Cloud persistence is a Phase 4+ concern that requires authentication infrastructure.

---

## Relationship to Existing Architecture

The existing architecture is preserved without modification:

- `POST /api/analyze` — unchanged
- `types/schema.ts` — extended, not replaced
- `lib/services/styleProfileService.ts` — extended to support the AI-generated profile alongside the manual profile
- `lib/services/openai/` — a new service module is added for profile generation; existing analysis service is unchanged
- `app/dashboard/profile/page.tsx` — extended to display generated profile; manual preference editing is preserved

No existing API contract is broken. No existing component is removed.

---

## Definition of Done for Phase 3

Phase 3 is complete when:

1. A user can initiate AI Style Profile generation from their profile page
2. The AI generates a structured profile from a single uploaded photo
3. The generated profile is stored in `localStorage` under a distinct key
4. The profile is injected into outfit analysis requests as additional context
5. The profile page displays the generated profile in a readable format
6. Every error state (image quality, AI failure, schema validation failure) produces a defined, non-broken experience
7. The existing manual style profile is preserved and continues to function
8. Benchmark evidence confirms analysis quality improvement on `style_preference_match` and `color` dimensions when the AI profile is present
