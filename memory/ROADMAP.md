# Roadmap

- Phase 1: MVP, decision report
- Phase 2: Better evaluation engine and benchmark validation
- Phase 3: Style DNA
- Phase 4: Shopping Advisor
- Phase 5: Wardrobe Memory
- Phase 6: Virtual Try-On
- Phase 7: Production polish

## Known follow-ups (not scheduled)

Behaviour that is deliberate today and worth revisiting. Each needs its own decision; none is changed as a side effect of other work.

- **Consistent photo replacement.** Where a card is one of several garment photos, the current photo stays until its replacement has been prepared and accepted. A card that holds the only photo (the personal photo, the single garment photo, the Style DNA photo) drops its photo as soon as another one is chosen, so a failed replacement leaves the card empty. This has been deliberate since PR #15 and is pinned by `tests/components/GarmentReplacement.test.tsx`. Making every card keep its photo until the replacement is accepted is a UX improvement to schedule; change the tests together with the behaviour.

## Change Log

Record any change to verdict weighting, rating enums, or evaluation dimensions here, with date and benchmark evidence. Shopping Advisor is advisory and does not change the deterministic verdict formula.

- (none yet, v1 verdict formula frozen)