# Human review: adding ground truth

This is how a person turns real images into reference cases that the evaluation
can score a model against. Nothing here needs a change to application code: you
add images to a local folder and edit two JSON files.

Until at least one case has been reviewed this way, every accuracy figure reads
`Unavailable: insufficient human-reviewed ground truth`. That is deliberate. A
figure that nobody checked against an image is not accuracy.

## What counts as ground truth

Every reference states where its expectation comes from. The evaluation keeps
the four kinds apart and never adds them together.

| Tier | `basis` | `status` | What it is | Scored as |
|---|---|---|---|---|
| Image-reviewed | `image_review` | `complete` | You looked at the actual image files and rated them | Agreement with human-reviewed references. The only tier that is evidence about accuracy on real images |
| Brief-derived | `brief` | `complete` | You derived the expectation from a written description, without an image | Its own section, labelled "not image-grounded" |
| Synthetic | `synthetic` | `complete` | Written to test the evaluation code | Its own section, labelled "not accuracy" |
| Unreviewed | any | `pending` or `in_progress` | A stub, or a review that is not finished | Never scored |

The image-reviewed tier cannot be reached by accident. It needs a reviewer, a
review date, a real image source, a statement of the right to use the image, the
SHA-256 of every image, and all six ratings. Image-reviewed figures also need
real model outputs: hand-written fixture outputs are never scored against them.

## Rules before you start

1. **Real images only, with the right to use them.** Your own photos (`owned`),
   images under a licence that allows this use (`public_license`), or photos from
   volunteers who agreed to this use (`approved_volunteer`). Never customer
   photos. AI-generated images may be used to test the pipeline, but they cannot
   be image-reviewed ground truth.
2. **Images never go into Git.** Put them under `benchmark/data/golden-v1/`. That
   folder is git-ignored, and a test fails if an image file is ever tracked under
   `evaluation/` or `benchmark/`. Only the text reference file is committed.
3. **Describe garments, never people.** Facts and descriptions are about the
   clothes and the setting. Do not describe the person's body, face, age or
   identity anywhere in a reference.
4. **Review blind.** Rate a case before you look at any model output for it.
   If you see the model's answer first, your rating is no longer independent.
5. **Use an identifier, not your name.** `reviewer.id` is a short label such as
   `gm`. It appears in reports.

One limit to know about: the recorder does not store model output for `owned`
and `approved_volunteer` photos, because the text describes a real person. Those
cases therefore cannot be scored. Only `public_license` cases are scored. That is
the current decision (see "Decisions" below): build the first golden dataset
from public-licence images.

## Workflow

### 1. Add the images

```
benchmark/data/golden-v1/
  gv-navy-blazer-interview/
    photo.jpg
    garment-1.jpg
```

Use `.jpg`, `.jpeg`, `.png` or `.webp`. One folder per case keeps things tidy.

### 2. Add the case to the manifest

Copy `evaluation/datasets/golden-v1/cases.template.json` to
`evaluation/datasets/golden-v1/cases.json` the first time, then add one entry
per case. Image paths are relative to `benchmark/data/golden-v1/`. Choose
`garment_mode` explicitly: `single` (omit the field), `same_garment_views` or
`outfit_items`, with one or two `extra_garments` for the last two.

### 3. Create the review stubs

```bash
node scripts/evaluation/review-stubs.cjs --manifest evaluation/datasets/golden-v1/cases.json --references evaluation/datasets/golden-v1/references.json --images benchmark/data/golden-v1 --write
```

This adds one empty stub per new case, with the image paths and the SHA-256 of
each file filled in. It never writes a rating and never changes a reference
that already exists.

### 4. Review each case

Open the images at full size. With the occasion and the style preferences of
the case in front of you, fill in the stub using the rubric below. Then set:

```json
"basis": "image_review",
"status": "complete",
"reviewer": { "id": "gm" },
"reviewed_on": "2026-11-20",
"provenance": { "image_source": "public_license", "rights": "Unsplash licence, photo by <author>, <url>" }
```

Leave a case at `"status": "in_progress"` until it is finished. It is not scored
until it is `complete`.

### 5. Validate

```bash
npm run eval:references -- --manifest evaluation/datasets/golden-v1/cases.json --references evaluation/datasets/golden-v1/references.json --images benchmark/data/golden-v1
```

It lists every problem at once, counts the cases in each tier, and compares each
image with its recorded hash. Bump `dataset_version` in the reference file
whenever a case or a reference changes.

### 6. Get model outputs (needs separate approval, costs money)

Model outputs come from a live benchmark run, which is billable and is never
started without explicit approval (`benchmark/README.md`). A dry run is free and
prints the worst-case cost:

```bash
BENCHMARK_MODEL=gpt-6.1-terra BENCHMARK_CASES=evaluation/datasets/golden-v1/cases.json BENCHMARK_DATA_DIR=benchmark/data/golden-v1 npm run benchmark
```

### 7. Score, free and repeatable

```bash
npm run eval:replay -- --manifest evaluation/datasets/golden-v1/cases.json --references evaluation/datasets/golden-v1/references.json --images benchmark/data/golden-v1 --recording benchmark/results/<file>.recording.json
```

A replay applies the same checks as the validator: a reference set that step 5
refuses is refused here too, including a review dated in the future and, with
`--images`, an image that is no longer the file that was reviewed. Without
`--images` the run says that the images were not checked.

Add `--baseline <earlier report>.json` to see, metric by metric, what improved,
regressed, was lost or stayed inconclusive.

## Rubric

Rate what the model is asked to rate. The definitions below are the ones in the
production system prompt (`memory/SYSTEM_PROMPT.md`), so that a disagreement
means a different judgement and not a different question.

### The five ratings

| Rating | Meaning |
|---|---|
| Excellent | Clearly right. You would not change anything about it for this dimension |
| Good | Works. One small reservation |
| Fair | Borderline. It could work, with a clear reservation or an adjustment |
| Poor | Clearly wrong for this dimension |
| Unable to Evaluate | The images and inputs do not let you judge this dimension. Use it honestly: it is a rating, not a gap |

Rate each dimension on its own. Do not let one weak dimension pull the others
down, and do not rate towards the verdict you expect: the application computes
the verdict, not the reviewer and not the model.

### The six dimensions

| Dimension | Question | Notes |
|---|---|---|
| `occasion` | Does the garment fit the stated occasion? | Judge the occasion named in the case, not occasions in general |
| `color` | Do the garment's colours work with the visible skin tone and the occasion? | If the lighting hides the true colour, say `Unable to Evaluate` |
| `formality` | Does the garment match the formality the occasion expects? | Too formal is as much a mismatch as too casual |
| `seasonality` | Is the garment appropriate for the implied season? | `Unable to Evaluate` when no season can be inferred |
| `style` | Does the garment align with the stated style preference? | See the note below |
| `style_preference_match` | Does the garment conflict with the stated style preference? | A direct conflict is Poor. With no stated preference, `Unable to Evaluate` |

**Note on `style`.** The system prompt defines `style` and
`style_preference_match` in almost the same words, while the product calls
`style` "Style consistency" and gives it no weight in the verdict. Until the
prompt is clarified, rate `style` exactly as the prompt asks. Expect the two
dimensions to agree closely, and treat that as a property of the current prompt.

You do not review confidence. The evaluation compares the confidence the model
states with how often its ratings agree with yours.

### Garment facts (outfits only)

For an outfit of several items, name the type of each garment image in order:
`top`, `bottom`, `outerwear`, `dress`, `footwear`, `accessory`, `suiting` or
`traditional_wear`. These are compared with the per-item notes the model
returns. `colour_family` and `pattern` may be recorded for later; the model
output has no field to compare them with yet.

### Key facts

List up to twelve things that are plainly visible and that a good explanation
would rest on. Each fact has:

- `statement`: the fact in plain words ("The jacket is navy").
- `attribute`: `garment`, `colour`, `pattern`, `fit`, `occasion` or `other`.
- `importance`: `key` when leaving it out means the explanation missed
  something important, otherwise `supporting`.
- `terms`: the words or short phrases that count as mentioning it. Any one is
  enough. List the variants you would accept: `["navy", "dark blue"]`.
- `contradicted_by` (optional): words that would contradict it, such as
  `["black", "grey"]` for a navy jacket.

`unverifiable_terms` lists details that **cannot** be seen in the images, such
as `["lining", "silk", "pockets"]`. An explanation that states one is making a
claim the image does not support.

These checks match whole words. They are a proxy: they cannot tell "navy" from
"not navy", and they miss a paraphrase you did not list. Read the cases a report
flags instead of trusting the number.

### Comparison groups

To compare one photo against several photos of the same garment, add the same
garment for the same occasion twice, once as a single photo and once as
`same_garment_views`, and give both references the same `comparison_group`.

## A complete reference

Placeholders in angle brackets must be replaced; the file does not validate with
them in place.

```json
{
  "case_id": "gv-navy-blazer-interview",
  "images": [
    { "id": "photo", "role": "photo", "path": "gv-navy-blazer-interview/photo.jpg", "sha256": "<filled in by review-stubs>" },
    { "id": "garment-1", "role": "garment", "path": "gv-navy-blazer-interview/garment-1.jpg", "sha256": "<filled in by review-stubs>" }
  ],
  "garment_description": "Single-breasted navy blazer with notch lapels, shown on a hanger.",
  "occasion": "Corporate Interview",
  "basis": "image_review",
  "status": "complete",
  "reviewer": { "id": "<your-id>" },
  "reviewed_on": "<YYYY-MM-DD>",
  "provenance": { "image_source": "public_license", "rights": "<licence name and source URL>" },
  "dimension_ratings": {
    "occasion": { "rating": "Excellent" },
    "color": { "rating": "Good", "note": "Navy is safe; slightly cool against the warm indoor light." },
    "formality": { "rating": "Excellent" },
    "seasonality": { "rating": "Unable to Evaluate", "note": "Nothing indicates a season." },
    "style": { "rating": "Good" },
    "style_preference_match": { "rating": "Good" }
  },
  "key_facts": [
    { "id": "colour", "statement": "The blazer is navy.", "attribute": "colour", "importance": "key", "terms": ["navy", "dark blue"], "contradicted_by": ["black", "grey"] },
    { "id": "cut", "statement": "It is a tailored, single-breasted blazer.", "attribute": "garment", "importance": "supporting", "terms": ["blazer", "tailored", "single-breasted"] }
  ],
  "unverifiable_terms": ["lining", "wool", "silk"]
}
```

## What your reviews make measurable

| Reviewed cases | What a report can then say |
|---|---|
| 0 | `Unavailable: insufficient human-reviewed ground truth` |
| 1 to 9 | Figures are shown and marked "too few to conclude". No regression is ever declared from them |
| 10 or more | Per-dimension exact agreement, agreement within one band and mean absolute error count as measured |
| 10 or more cases that state a confidence level | That level's agreement counts as measured. The confidence gap and the ordering need this for each level they compare |
| 10 or more outfit cases | Garment type accuracy and outfit note completeness count as measured |
| 10 or more comparison groups | One photo against several counts as measured |

Every count is a count of cases. Running a case three times, or an outfit of
three items, does not add to it.

The minimum is ten units per figure, and a difference between two reports counts
only when it exceeds the noise margin (`evaluation/README.md`). Thirty to fifty
cases spread over the three garment modes is a sensible first target; ten cases
of one kind tell you about that kind only.

## Keeping it honest

- A reference is changed only to correct a mistake in the review. Say what
  changed in `review_notes` and bump `dataset_version`. Never adjust a rating
  because the model disagreed.
- An image is never swapped under a finished review. The validator, and a
  replay given `--images`, refuse a file whose hash changed; review it again.
  The hash ties the review to the image file. It does not tie a recording to
  it: run the live benchmark on the same files that were reviewed, and validate
  with `--images` right before it.
- A reference set that fails validation stops the evaluation. Nothing is skipped
  quietly.
- None of these rules can stop someone from typing a false review. They make
  sure it has to be a deliberate, attributable one: a named reviewer, a date and
  the hash of the file.

## Decisions

### Decided: only public-licence cases are scored, for now

Decided on 2026-11-17. Model output for `owned` and `approved_volunteer` photos
stays withheld from recordings, because the text describes a real person. Those
cases are counted as withheld and are not scored. The first golden dataset is
therefore built from `public_license` images.

Nothing in the code needs to change for this: it is how the recorder already
behaves. Two alternatives were considered and not taken. Either would be a
privacy change and needs its own decision:

- store only the enumerated values for those cases (ratings, confidence, outfit
  garment types) and no text, so that ratings could be scored and grounding
  could not;
- keep full outputs for your own photos, locally, by explicit choice.

### Open: the `style` and `style_preference_match` dimensions overlap

The system prompt defines `style` as "does the garment align with the user's
stated style preference" and `style_preference_match` as naming a conflict with
that same preference. The product shows `style` as "Style consistency" and gives
it no weight in the verdict.

This is a product decision, not an evaluation setting. The prompt is not changed
by this framework. Until it is decided, reviewers rate `style` as the prompt
defines it (see the rubric above), and agreement on the two dimensions is
expected to move together. Any change to the prompt needs its own approval and a
new recording, because a prompt change makes earlier recordings a different
prompt version.
