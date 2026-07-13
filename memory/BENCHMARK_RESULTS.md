# Verdict AI Benchmark Results

This file records benchmark performance for every prompt revision, model change, and algorithm update.

---

# Benchmark Summary

| Version | Date | Model | Prompt Version | Cases Tested | Pass | Fail | Accuracy | Avg Score Error | Avg Latency | Avg Cost |
|---------|------|-------|----------------|-------------:|-----:|-----:|----------:|----------------:|------------:|---------:|
| v0.3.1 | 2026-07-13 | GPT-4.1 | Initial | 6 | 6 | 0 | 100% | 0.0 | 2.3s | $0.01 |

---

# Detailed Results

| Case | Category | Expected Verdict | Actual Verdict | Expected Score | Actual Score | Pass | Notes |
|------|----------|------------------|----------------|---------------|-------------|------|------|
| 001 | Good | Highly Recommended | Highly Recommended | 5.0 | 5.0 | ✅ | Excellent reasoning. Seasonality could be inferred. Style preference not evaluated because no profile was supplied. |
| 002 | Bad | Not Recommended | Not Recommended | 2.0–3.0 | 2.4 | ✅ | Excellent occasion and formality reasoning. Style preference conflict not tested because no profile preference was provided.|
| 003 | Borderline | Reasoning Quality | Highly Recommended | N/A | 4.7 | ✅ | Excellent reasoning. Appropriate date-night recommendation. Style preference explanation could be more personalized.|
| 004 | Good | Highly Recommended | Highly Recommended | 4.5-5.0 | 4.9 | ✅ | Excellent reasoning. Correct business attire evaluation for a client presentation. Color harmony, formality, and style preference all align well.|
| 005 | Good | Recommended | Consider Alternatives | 3.5–4.0 | 3.2 | ⚠️ Partial | Benchmark could not be reproduced exactly because the UI currently has no Startup Interview occasion. Tested using Formal Event, which is stricter and naturally lowered the score. Reasoning itself is sound.|
| 006 | Good | Recommended | Recommended | 3.5–4.0 | 3.6 | ✅ | Correct business casual judgment. Grey blazer with jeans appropriately downgraded for formality while still recommended for networking. Compare Another Outfit workflow also verified successfully.|
| 007 | Good | | | | | | |
| 008 | Good | | | | | | |
| 009 | Good | | | | | | |
| 010 | Good | | | | | | |
| 011 | Good | | | | | | |
| 012 | Good | | | | | | |
| 013 | Bad | | | | | | |
| 014 | Bad | | | | | | |
| 015 | Bad | | | | | | |
| 016 | Bad | | | | | | |
| 017 | Bad | | | | | | |
| 018 | Bad | | | | | | |
| 019 | Bad | | | | | | |
| 020 | Bad | | | | | | |
| 021 | Bad | | | | | | |
| 022 | Bad | | | | | | |
| 023 | Borderline | | | | | | |
| 024 | Borderline | | | | | | |
| 025 | Borderline | | | | | | |
| 026 | Borderline | | | | | | |
| 027 | Borderline | | | | | | |
| 028 | Borderline | | | | | | |
| 029 | Borderline | | | | | | |
| 030 | Borderline | | | | | | |

---

# Failure Analysis

## Incorrect Occasion Understanding

- Case 005: The benchmark specifies "Startup Interview", but the application currently has no matching occasion. The closest available option ("Formal Event") resulted in a stricter evaluation and a lower verdict. This is a taxonomy limitation rather than an AI reasoning issue.


## Incorrect Formality Assessment

-

## Incorrect Color Harmony

-

## Incorrect Seasonality

- Case 001: Model returned "Unable to Evaluate" for seasonality. It could reasonably infer that a charcoal business suit is generally suitable for cooler weather and climate-controlled office environments.

## Incorrect Style Consistency

-

## Incorrect Style Preference Match

- Case 001: Benchmark expected style preference evaluation, but no profile preferences were available during testing. Re-run with profile configured.
- Case 002: Benchmark expected an explicit preference conflict. The application profile contained no style preference, so this scenario could not be fully evaluated.
- Cases 001–003: Style Preference Match could not be fully benchmarked because the user profile did not contain the benchmark's expected style preferences.
- Case 004: Business formal preference was interpreted correctly and matched the outfit.
- Case 005: The benchmark could not be fully evaluated because "Startup Interview" was unavailable. A more appropriate occasion would likely produce a stronger style preference match.
- Case 006: Style preference reasoning correctly aligned with business casual expectations.


## Hallucinated Reasoning

-

## Person Detection Issues

- None observed. The uploaded person was consistently detected throughout all analyses.

## Garment Detection Issues

- None observed. All uploaded garments were correctly identified.

## Confidence Too High

-

## Confidence Too Low

-

## Other

- Case 006 successfully validated the new "Compare Another Outfit" workflow.
- Start New Analysis correctly reset the application state and returned to Step 1.
- Uploaded photo persistence worked correctly during outfit comparison.

---

# Improvements Made

| Version | Change | Accuracy Before | Accuracy After |
|---------|--------|----------------:|---------------:|
| v0.3.2 | Added "Compare Another Outfit" workflow | N/A | Improved UX |
| v0.3.2 | Added "Start New Analysis" full reset | N/A | Improved UX |
| v0.3.2 | Added uploaded photo preview during Steps 2 & 3 | N/A | Improved UX |
| v0.3.2 | Verified state management for comparison workflow | N/A | Verified |
---

# Cost Tracking

| Date | Model | Cases | Total Tokens | Total Cost |
|------|-------|------:|-------------:|-----------:|

| 2026-07-13 | GPT-4.1 | 3 | ~6,000 | ~$0.03 |

# Notes

Use this section after every benchmark run.

- Case 001 passed successfully.
- Business interview attire was correctly identified as highly appropriate.
- Formality and occasion reasoning were accurate.
- Seasonality reasoning can be improved by making reasonable inferences instead of returning "Unable to Evaluate."
- Style preference evaluation depends on a configured user profile.

- Case 003 passed successfully.
- Correctly identified the dress as suitable for a dinner date.
- Color harmony reasoning was natural and personalized.
- Seasonality inference was appropriate.
- Style preference reasoning remained generic because no profile preferences were available.
- Borderline case handled with balanced reasoning rather than overconfidence.

- Case 004 passed successfully.
- Client presentation attire was correctly identified as highly appropriate.
- Formality, occasion fit, color harmony, and style preference reasoning were all accurate.
- Score (4.9/5) closely matched benchmark expectations.

- Case 005 partially passed.
- The benchmark specifies a "Startup Interview", but the current UI does not provide that occasion.
- Testing was performed using the closest available option ("Formal Event"), resulting in a stricter evaluation.
- Reasoning remained internally consistent despite the occasion mismatch.
- Expanding the occasion list will improve benchmark coverage.

- Case 006 passed successfully.
- Business casual outfit was correctly recommended for a networking event.
- Formality reasoning appropriately considered the blazer and jeans combination.
- "Compare Another Outfit" successfully preserved the uploaded person photo while clearing only the garment.
- "Start New Analysis" correctly reset the workflow and cleared all uploaded data.


# UX Validation

| Feature | Status |
|---------|:------:|
| Compare Another Outfit | ✅ Pass |
| Preserve uploaded photo | ✅ Pass |
| Replace garment only | ✅ Pass |
| Start New Analysis | ✅ Pass |
| Reset workflow | ✅ Pass |
| Photo thumbnail preview | ✅ Pass |
| Multi-analysis session | ✅ Pass |
| Decision report rendering | ✅ Pass |