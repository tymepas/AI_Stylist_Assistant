# Evaluation Dataset

30 benchmark scenarios: 10 good matches, 10 bad matches, 10 borderline.

## Measure
- Verdict correctness (good/bad cases only)
- Reason quality
- Confidence appropriateness
- Failure handling (insufficient input cases)

## Success Criteria
≥90% agreement on clearly good and clearly bad cases. Borderline cases are judged on reasoning quality, not verdict agreement, since reasonable people could disagree.

## Case Template
```
Case ID:
Photo description:
Garment description:
Occasion:
Stated style preference:
Category: good | bad | borderline
Expected verdict (if not borderline):
Notes:
```

## Examples

**Case 001** — Photo: neutral lighting. Garment: charcoal tailored blazer, slim fit. Occasion: job interview. Preference: formal/minimal. Category: good. Expected: Recommended or Highly Recommended.

**Case 002** — Photo: bright daylight. Garment: neon graphic streetwear hoodie, oversized. Occasion: wedding guest. Preference: formal. Category: bad. Expected: Not Recommended. Should trigger an explicit style_preference_match conflict, not a silent average.

**Case 003** — Photo: mixed indoor lighting. Garment: dark green midi dress, plain. Occasion: dinner date. Preference: smart casual. Category: borderline. Notes: tests reasoning quality, not verdict, since the right answer depends on context the model can't know.

Fill in the remaining 27 cases following this pattern before the first full benchmark run.
