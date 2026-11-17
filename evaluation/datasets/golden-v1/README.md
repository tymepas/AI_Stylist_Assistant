# Golden dataset v1

Real images, rated by a person, for measuring a model against. **It is empty.**
No case has been reviewed yet, so every accuracy figure reads
`Unavailable: insufficient human-reviewed ground truth`.

| File | What it is | In Git |
|---|---|---|
| `cases.template.json` | Example manifest: one case per garment mode. Not real cases | Yes |
| `references.template.json` | The review stubs `review-stubs.cjs` generates for the template. All unreviewed | Yes |
| `cases.json` | The real manifest. Create it by copying the template | Yes, once it exists |
| `references.json` | The real reviews: ratings, garment facts, key facts, image hashes. Text only | Yes, once it exists |
| `benchmark/data/golden-v1/` | The images | **Never.** Git-ignored |
| `benchmark/results/*.recording.json` | Model outputs from an approved live run | No. Git-ignored |

How to add cases, the review rubric and every command: `evaluation/HUMAN_REVIEW.md`.

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
