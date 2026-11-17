# Golden dataset v1

Real images, rated by a person, for measuring a model against. **It is empty.**
No case has been reviewed yet, so every accuracy figure reads
`Unavailable: insufficient human-reviewed ground truth`.

What is committed is a **plan**: which cases a balanced benchmark needs. It
holds no image, no rating and no expected verdict band. Each brief says what
kind of image to look for, which is a sourcing criterion and not a rating.

| File | What it is | In Git |
|---|---|---|
| `cases.template.json` | The case plan: 41 planned cases, each a brief of what its images should show. Written by `npm run eval:build-golden-plan` | Yes |
| `references.template.json` | One empty review stub per planned case. All unreviewed | Yes |
| `cases.json` | The real manifest. Create it by copying the template | Yes, once it exists |
| `references.json` | The real reviews: ratings, garment facts, key facts, image hashes. Text only | Yes, once it exists |
| `benchmark/data/golden-v1/` | The images | **Never.** Git-ignored |
| `benchmark/results/*.recording.json` | Model outputs from an approved live run | No. Git-ignored |

How to add cases, the review rubric and every command: `evaluation/HUMAN_REVIEW.md`.

## What the plan contains

| | Cases | Garment images |
|---|---|---|
| One garment photo | 21 | 21 |
| Several views of one garment | 10 | 24 |
| Items of one outfit | 10 | 25 |
| **Total** | **41** | **70**, plus 41 personal photos: 111 image slots, 91 different files |

Cases and images are counted apart on purpose. Every sample size in a report
counts cases; an outfit of three items is one case.

- **Ten cases or more in each garment mode**, the minimum for a figure about a
  mode to count as measured.
- **Ten comparison pairs.** Garments `g01` to `g10` each appear as a single
  photo and as two or three views, with the same personal photo and occasion.
  A pair points at the same files.
- **Fourteen cases send an invented Style DNA profile**: six single, four
  multi-view and four outfits, so that the Shopping Advisor is exercised.
  Style DNA is a condition on a case, not a garment mode: each of these cases
  is counted in exactly one mode. Four of the fourteen are the second half of
  a pair, so they are ten different photo-and-garment combinations. Only
  aesthetic-only personas are used: they leave colouring and proportions empty
  and so cannot contradict a real photo. No personal profile is part of this
  data, and the manifest refuses any profile not marked `synthetic`.
- **Eleven further single-photo cases** (`gv-s01` to `gv-s11`, named neutrally
  so that an id does not tell a reviewer what to expect): two borderline fits,
  three with poor image quality, two with ambiguous detail, two with text in
  the image and two with insufficient input.
- **Every case is `public_license`**, the only source whose model output a
  recording stores.

The plan is a starting point. Rewrite a brief to fit the image you find, or
remove an entry; the validator says which garment mode then falls short.

## What the plan does not give

- **Margin.** The two multi-image modes and the comparison pairs have exactly
  ten cases each. One case without a complete output puts the figures of its
  mode back to "too few to conclude".
- **Independent cases throughout.** The two cases of a pair share photo, garment
  and occasion. The 39 cases that can give ratings are 29 different
  combinations.
- **A split by Style DNA.** Figures pool cases with and without a profile.
  Without the Style DNA cases the multi-image modes have six cases each.

Two ways to remove these limits are costed in
`evaluation/LIVE_VALIDATION_PLAN.md` ("Options that cost more"). Neither is
part of the plan as committed.

## Why the images are kept out of Git

A photo of a person, once pushed, cannot be taken back: it stays in the history
of every clone. The reference file holds what the evaluation needs and nothing
that identifies anyone: ratings, garment facts and the SHA-256 of each image.
The hash ties a review to the exact file that was looked at, so the images can
live on a local disk or in private storage and the reviews stay verifiable.

Consequences to plan for:

- CI cannot check images against their hashes, because it has no images. It
  checks the reference file itself. Run the validator with `--images` locally.
- The images are not backed up by Git. Keep your own copy. A lost image means
  its review can no longer be re-run, although the recorded outputs still score.
- Anyone who needs to re-run a live benchmark needs the images from you.

## Versioning

- `dataset_version` in `references.json` is bumped by hand whenever a case or a
  review changes (major.minor.patch).
- A report also carries two fingerprints computed from content: one for the
  manifest and one for the reference set. Two reports are compared metric by
  metric only when both fingerprints match; otherwise the comparison says
  "inconclusive" instead of inventing a trend.
- When the dataset has grown enough to be a different dataset, start
  `golden-v2` rather than rewriting this one.
