# Verdict — AI Fashion Decision Assistant (Phase 1)

Verdict helps people decide with confidence whether a piece of clothing suits them, their occasion, and their
style — **before** they spend money. It is a decision-support tool, not a chatbot, not an outfit-scoring toy.

This repository contains **Phase 1 MVP** — a polished, production-quality SaaS product with a live AI analysis engine powered by GPT-4.1 Vision.

## What's included (Phase 1)

- **Landing page** — dark, premium SaaS design (hero, value props, features, how-it-works, CTA).
- **Dashboard** — responsive sidebar (Dashboard, Style Profile, Analysis, Settings).
- **Style Profile** — preferred style, favorite colors, occasion preferences. Stored in the browser (`localStorage`) only — no backend database required.
- **Analysis flow** — upload a personal photo, upload a clothing image, pick an occasion, click Analyze.
- **AI analysis** — evaluated by GPT-4.1 Vision across six dimensions. The overall verdict is **calculated** by the app using a fixed weighted formula, never invented by the model.
- **Decision Report** — evaluation dimensions, confidence, things to consider, what was/wasn't considered.
- **Outfit Comparison** — compare a second garment without re-uploading your personal photo.
- **Loading and failure states** — missing upload, invalid upload, unable to analyze, with Retry.

## Explicitly out of scope for Phase 1

Saved history, user accounts, cloud sync, and AI Vision (direct camera) are intentionally **not** implemented yet (see `memory/PRD.md` → Roadmap).

## Tech stack

Next.js 15 (App Router) · TypeScript · Tailwind CSS · shadcn/ui · Framer Motion · Lucide Icons

## Project structure

```
app/
  page.tsx                  # Landing page
  layout.tsx                # Root layout (dark theme)
  api/[[...path]]/route.js  # Backend routes, incl. POST /api/analyze (mock)
  dashboard/
    layout.tsx               # Sidebar shell
    page.tsx                 # Dashboard home
    profile/page.tsx         # Style Profile
    analysis/page.tsx        # Upload + Analyze + Decision Report flow
    settings/page.tsx
    history/page.tsx         # Roadmap placeholder — intentional empty state
components/fashion/          # Sidebar, UploadCard, LoadingAnalysis, ErrorState, DecisionReport, RatingBadge
lib/services/                # analysisService.ts (mock engine + verdict formula), styleProfileService.ts
types/schema.ts              # TypeScript types mirroring AI_OUTPUT_SCHEMA.md
```

## Running locally

Dependencies are managed with `yarn` and the app is served via `supervisor` in this environment.

```
yarn install
yarn dev
```

The app runs on port 3000. All backend routes are served under `/api`.

## Source-of-truth docs

`memory/PRD.md`, `AI_OUTPUT_SCHEMA.md`, `MEMORY.md`, and `SYSTEM_PROMPT.md` (provided by the product owner) define
the product vision, schema, and philosophy. Any implementation decision defers to these documents.
