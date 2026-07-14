# Verdict AI

> **Know Before You Buy.**
>
> AI-powered fashion purchase decision support that helps users make better clothing decisions before spending money.

![Next.js](https://img.shields.io/badge/Next.js-15-black)
![TypeScript](https://img.shields.io/badge/TypeScript-5.x-blue)
![OpenAI](https://img.shields.io/badge/OpenAI-GPT--4.1%20Vision-green)
![License](https://img.shields.io/badge/License-MIT-yellow)
![Status](https://img.shields.io/badge/Status-Phase%203%20Complete-success)

---

# Overview

Verdict AI is an explainable AI fashion decision-support platform.

Instead of recommending random products or generating unrealistic outfit suggestions, Verdict helps users answer one simple question:

> **"Should I buy this?"**

Users upload:

- A current personal photo
- A garment photo
- An occasion
- Optional style preferences

Verdict analyzes multiple fashion dimensions, explains every decision, and provides a transparent recommendation before the purchase.

---

# Key Features

## AI Outfit Analysis

Analyze garments against:

- Occasion Fit
- Color Harmony
- Formality
- Seasonality
- Style Consistency
- Style Preference Match

Every recommendation includes explainable reasoning.

---

## Style DNA (Phase 3)

Generate a personalized AI Style DNA from a single photo.

Style DNA captures long-term styling characteristics including:

- Coloring
- Body proportions (observable)
- Style signals
- Clothing preferences
- Analysis confidence

During future outfit analyses, Verdict combines:

- Current photo
- Style DNA
- Garment
- Occasion

to deliver more personalized recommendations.

The original profile photo is **not retained**. Only structured Style DNA data is stored locally.

---

## Explainable AI

Verdict never returns a simple score without explanation.

Every recommendation includes:

- Dimension-by-dimension reasoning
- Confidence indicators
- Strengths
- Considerations
- Transparent decision factors

---

## Privacy First

Privacy is a core design principle.

- Personal photos are analyzed only for the current request.
- Original Style DNA photos are not retained.
- Only structured Style DNA JSON is stored locally.
- Outfit analysis continues to require a current personal photo for up-to-date context.

---

# Technology Stack

## Frontend

- Next.js 15
- React
- TypeScript
- Tailwind CSS

## Backend

- Next.js API Routes
- OpenAI Responses API
- GPT-4.1 Vision

## Validation

- Zod Runtime Validation
- Multipart Upload Validation
- MIME Validation
- Image Dimension Validation
- File Size Validation

---

# AI Architecture

```text
Current Photo
        +
Style DNA
        +
Garment Photo
        +
Occasion
        +
Style Preferences
            │
            ▼
OpenAI GPT-4.1 Vision
            │
            ▼
Structured AI Response
            │
            ▼
Runtime Schema Validation
            │
            ▼
Deterministic Verdict Calculation
            │
            ▼
Decision Report
```

---

# Project Status

## Phase 1 — MVP

✅ Complete

- Mock AI responses
- Outfit analysis workflow
- Decision report
- Style preferences
- Responsive UI

---

## Phase 2 — AI Integration

✅ Complete

- GPT-4.1 Vision integration
- OpenAI Responses API
- Multipart uploads
- Runtime validation
- Error handling
- Benchmark framework
- 30 benchmark cases

---

## Phase 3 — Style DNA

✅ Complete

- AI Style DNA generation
- Persistent structured profile
- Personalized analysis context
- Privacy-first storage model
- Regenerate & Delete flows
- UX polish
- Responsive interface

---

## Phase 4 — Shopping Recommendations

🚧 Planned

Upcoming work includes:

- AI shopping recommendations
- Product matching
- Alternative suggestions
- Explainable recommendation engine
- Personalized shopping assistant

---

# Repository Structure

```text
app/
components/
lib/
memory/
public/
specs/
tests/
types/
```

---

# Running Locally

Install dependencies:

```bash
npm install
```

Run development server:

```bash
npm run dev
```

Run TypeScript:

```bash
npm run typecheck
```

Run tests:

```bash
npm test
```

Build production:

```bash
npm run build
```

---

# Testing

Current test coverage includes:

- Runtime schema validation
- Storage services
- Local persistence
- API integration
- Route validation
- Error handling
- Graceful degradation
- Type safety

All current tests pass successfully.

---

# Design Principles

Verdict is intentionally designed to be:

- Explainable
- Privacy-first
- AI-assisted rather than AI-authoritative
- Respectful
- Transparent
- Production-ready
- Scalable

---

# Roadmap

| Phase | Status |
|---------|--------|
| Phase 1 – MVP | ✅ Complete |
| Phase 2 – AI Integration | ✅ Complete |
| Phase 3 – Style DNA | ✅ Complete |
| Phase 4 – Shopping Recommendations | 🚧 Planned |
| Phase 5 – Wardrobe Memory | 📋 Planned |
| Phase 6 – Virtual Try-On | 📋 Planned |

---

# License

MIT License

---

# Acknowledgements

Built with:

- Next.js
- TypeScript
- Tailwind CSS
- OpenAI GPT-4.1 Vision

---

## Verdict AI

**Know Before You Buy.**
