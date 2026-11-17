# Roadmap

- Phase 1: MVP, decision report
- Phase 2: Better evaluation engine and benchmark validation
- Phase 3: Style DNA
- Phase 4: Shopping Advisor
- Phase 5: Wardrobe Memory
- Phase 6: Virtual Try-On
- Phase 7: Production polish

## Fashion Intelligence and AI Reliability 2.0

The current programme of work on the quality and reliability of the analysis. Every step is advisory to the verdict: `computeVerdict` stays the only source of the verdict, and each prompt, schema or model change needs its own approval and a new recording.

| Milestone | What | Status |
|---|---|---|
| 0 | A measured baseline: balanced datasets, review rubric, second reviews, Style DNA in the benchmark, dry run | Prepared; awaiting review. The live run it prepares for is **not approved and has not been run** |
| 1 and later | Changes to what the model is asked to return | Not started. Each needs approval after Milestone 0 has been reviewed |

What Milestone 0 still needs from a person before anything is measured: public-licence images for the 41 planned cases, a review of each, a second review of at least ten, and a separately approved live run.

## Known follow-ups (not scheduled)

Behaviour that is deliberate today and worth revisiting. Each needs its own decision; none is changed as a side effect of other work.

- **Consistent photo replacement.** Where a card is one of several garment photos, the current photo stays until its replacement has been prepared and accepted. A card that holds the only photo (the personal photo, the single garment photo, the Style DNA photo) drops its photo as soon as another one is chosen, so a failed replacement leaves the card empty. This has been deliberate since PR #15 and is pinned by `tests/components/GarmentReplacement.test.tsx`. Making every card keep its photo until the replacement is accepted is a UX improvement to schedule; change the tests together with the behaviour.
- **Deleting Style DNA from Settings.** "Clear Style Preferences" on the Settings page removes the manual style preferences only. Style DNA is a separate entry in the browser and is deleted on the Style profile page; the Settings page says so. Whether Settings should also offer to delete Style DNA, or delete both at once, is a product decision that has not been made.
- **Review step and submission read the profile from different places.** The Review step shows the style preferences and Style DNA held in page state; the request re-reads both from browser storage when Analyze is pressed. They differ only if storage changed in another tab in between. Sending exactly what the Review step shows would remove the gap.

## Change Log

Record any change to verdict weighting, rating enums, or evaluation dimensions here, with date and benchmark evidence. Shopping Advisor is advisory and does not change the deterministic verdict formula.

- (none yet, v1 verdict formula frozen)