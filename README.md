# Verdict — AI Fashion Decision Assistant (Phase 1)

Verdict helps people decide with confidence whether a piece of clothing suits them, their occasion, and their
style — **before** they spend money. It is a decision-support tool, not a chatbot, not an outfit-scoring toy.

This repository contains **Phase 1** only: a production-quality, dark-themed SaaS foundation built with a fully
mocked analysis engine, ready to be wired up to a real multimodal AI model later.

## What's included (Phase 1)

- **Landing page** — dark, premium SaaS design (hero, value props, features, how-it-works, CTA).
- **Dashboard** — responsive sidebar (Dashboard, Profile, Analysis, Settings, History — Coming Soon).
- **Style Profile** — preferred style, favorite colors, occasion preferences. Stored in the browser
  (`localStorage`) only — no backend database.
- **Analysis flow** — upload a personal photo, upload a clothing image, pick an occasion, click Analyze.
- **Mock `AnalysisService`** — returns realistic JSON matching `AI_OUTPUT_SCHEMA.md` exactly, rotating randomly
  between three scenarios: Highly Recommended, Not Recommended (with a named style-preference conflict), and
  Unable to Analyze. The overall verdict is **calculated** by the app using the weighted formula from `PRD.md`
  — never invented by the mock "model" output.
- **Decision Report** — evaluation dimensions, confidence, things to consider, what was/wasn't considered.
- **Loading and failure states** — missing upload, invalid upload, unable to analyze, with Retry.

## Explicitly out of scope for Phase 1

Real AI calls, authentication, a database, virtual try-on, shopping search, wardrobe memory, and history are
intentionally **not** implemented yet (see `memory/PRD.md` → Non Goals / Roadmap).

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
    history/page.tsx         # Coming Soon
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
