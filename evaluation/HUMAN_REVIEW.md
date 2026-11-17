# Human review: adding ground truth

This is how a person turns real images into reference cases that the evaluation
can score a model against. Nothing here needs a change to application code: you
add images to a local folder and edit two JSON files.

Until at least one case has been reviewed this way, every accuracy figure reads
`Unavailable: insufficient human-reviewed ground truth`. That is deliberate. A
figure that nobody checked against an image is not accuracy.

**A review is a judgement, not a fact.** Whether a jacket is "Good" or "Fair"
for a dinner is something two careful people can differ on. This guide
therefore does three things: it gives a rubric that makes ratings as
repeatable as they can be, it asks for a second, independent review of at least
part of the cases, and it records every difference between two reviewers
instead of resolving it. A report then says how far reviewers agree with each
other before it says how far a model agrees with one of them. See
[Second reviews and disagreements](#second-reviews-and-disagreements).

## Cases and images are counted apart

A **case** is one analysis: one personal photo, one occasion, one to three
garment images. An **image** is a file. An outfit of three items is one case
with four images; ten such outfits are ten cases, not forty.

Every sample size in a report counts cases. Images matter for two other things
only: what a live run can cost at most, and how many files you have to source.
The validator and the benchmark dry run print both numbers side by side, and
say which garment modes still need cases to reach the minimum of ten.

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
6. **Style DNA in a case is always invented.** A case may send a Style DNA
   profile so that the Shopping Advisor is exercised. Only the invented
   personas in `scripts/evaluation/style-dna-personas.cjs` are allowed, marked
   `"source": "synthetic"`; the manifest refuses anything else. Never paste a
   profile that the application produced from a real person's photo, yours
   included. Next to a real photo use an aesthetic-only persona: it states
   style signals and leaves colouring and proportions empty, so it cannot
   contradict what the photo shows.

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

`evaluation/datasets/golden-v1/cases.template.json` is a **plan** of 45 cases:
21 with one garment photo, 12 with several views of one garment and 12 outfits.
Every garment mode reaches the minimum of ten cases, and each multi-image mode
has two reserve cases beyond it, so that one case without a complete output
does not cost the mode its figures. Each entry is a brief of what its images
should show ("PLANNED, no image yet: ..."). It holds no image, no rating and no
expected verdict band.

`evaluation/datasets/golden-v1/CASE_MATRIX.md` lists every planned case with
its garment mode, its number of images, whether it sends Style DNA, whether it
is expected to abstain, whether it gives ratings, and whether its results are
reported in a separate figure or only in a pooled one.

A brief is a sourcing criterion, not a rating. "A clear mismatch for the
occasion" tells you what kind of image to look for; it does not tell you what
to rate. Rate what the image you found actually shows, and before you review a
case replace its "PLANNED" description with a neutral description of the
images, so that the brief does not sit next to the case while you rate it.
The eleven extra single cases have neutral ids (`gv-s01` to `gv-s11`) for the
same reason: an id is shown to every reviewer.

Copy it to `evaluation/datasets/golden-v1/cases.json` the first time. Then, for
each entry, source images that fit the brief, or rewrite the brief to fit the
images you have, and replace the "PLANNED" description with what the images
actually show. Remove an entry you cannot fill; the validator tells you which
garment mode then falls short of ten. Image paths are relative to
`benchmark/data/golden-v1/`. Choose `garment_mode` explicitly: `single` (omit
the field), `same_garment_views` or `outfit_items`, with one or two
`extra_garments` for the last two.

Ten garments in the plan (`g01` to `g10`) appear twice: once as a single photo
and once as two or three views, with the same personal photo and occasion.
Both cases point at the same files, so a pair shows the same garment by
construction. These pairs are what makes "one photo against several"
measurable.

Leave `expected.acceptable_bands` empty unless you, as the reviewer, are
prepared to say which verdict bands are acceptable for the actual image.

Two tests pin the golden folder to the plan files (`tests/evaluation/referenceSet.test.ts`,
"leave the golden dataset empty until real images have been reviewed"). They
fail as soon as `cases.json` exists, on purpose: update them in the commit
that adds the real dataset.

Three things about the plan to keep in mind while you fill it:

- **Margin, and where there is none.** Each multi-image mode has twelve cases:
  two more than a figure needs. The comparison pairs have no margin: there are
  exactly ten, and a reserve case has no single-photo twin. One pair without a
  complete output on both sides puts "one photo against several" back to "too
  few to conclude".
- **Pairs are not independent.** The two cases of a pair share the photo, the
  garment and the occasion. They are two cases and count as two, and they are
  not two independent observations: the 43 cases that can give ratings are 33
  different photo, garment and occasion combinations.
- **Style DNA is a condition on a case, not a garment mode.** Fourteen cases
  send a profile (six single, four multi-view, four outfits). Each is counted
  in exactly one mode. A profile changes what the model is told, so a report
  never mixes the two conditions silently: every figure that combines them is
  labelled as pooled, and next to it each condition gets a figure of its own
  wherever ten cases of that condition stand behind it. With fewer, the
  separate figure is unavailable. In this plan that gives separate figures for
  all cases without Style DNA (29), all cases with it (14) and single-garment
  cases without it (13); the multi-image modes have eight cases without and
  four with, so their figures exist only pooled. Both cases of a pair carry
  the same profile or neither does, and the validator refuses a pair that
  differs.

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
image with its recorded hash. It also prints how ready the dataset is: cases and
images counted apart, image-reviewed cases per garment mode against the minimum
of ten, how many cases a second person has rated, and every case on which two
reviewers differ. Bump `dataset_version` in the reference file whenever a case
or a reference changes.

### 5a. Get a second, independent review

Before any model output exists, have a second person rate at least ten cases,
ideally all of them. See
[Second reviews and disagreements](#second-reviews-and-disagreements).

### 6. Get model outputs (needs separate approval, costs money)

Model outputs come from a live benchmark run, which is billable and is never
started without explicit approval (`benchmark/README.md`). A dry run is free and
prints the amounts a live run would reserve (a sum of reservations, not a guaranteed maximum spend):

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

### How to rate

1. Read the occasion and the style preferences of the case first. They are part
   of the question.
2. Look at every image of the case at full size. For several views, all views
   are evidence about one garment. For an outfit, rate the outfit as a whole.
3. Rate the six dimensions one at a time, in the order below. Decide each
   before you look at the next.
4. When you hesitate between two bands, choose one and say so in the `note` of
   that dimension ("between Good and Fair: the hem is not visible"). That
   hesitation is useful information, and a second review will show whether
   another person lands on the other side.
5. Use `Unable to Evaluate` whenever the images and inputs do not let you
   judge. Do not guess in order to avoid it.

What you never rate: whether you like the garment, whether it flatters the
person, price, brand, material quality, durability or comfort. The model is
told to leave these out, so a rating that rests on them measures something else.

### The six dimensions

Each dimension has a question, taken from the production system prompt, and an
anchor for every band. The anchors are examples of the band, not a checklist:
where a case fits none of them, rate by the question.

#### `occasion`: does the garment fit the stated occasion?

Judge the occasion named in the case, not occasions in general.

| Rating | Anchor |
|---|---|
| Excellent | What people at this occasion would expect to see. Nothing to change |
| Good | Appropriate. One small reservation, for example slightly more relaxed or more dressed up than usual |
| Fair | Unusual for the occasion. It could pass with other pieces or careful styling |
| Poor | Clearly at odds with the occasion: a hoodie at a wedding, an evening dress for a shopping trip, bridal white on a guest |
| Unable to Evaluate | Too little of the garment is visible to tell what it is |

#### `color`: do the garment's colours work with the visible skin tone and the occasion?

Three things are compared: the garment's colours with each other, with the
colouring visible in the personal photo, and with the occasion. Say in the note
which of the three decided your rating. Write about the colours, not about the
person.

| Rating | Anchor |
|---|---|
| Excellent | The colours sit well together, with the visible colouring and with the occasion |
| Good | Works. One combination is a little less settled, or slightly unusual for the occasion |
| Fair | Uneven. Some tones compete, or the colour is a questionable choice for the occasion |
| Poor | A clear clash, or a colour the conventions of the occasion rule out |
| Unable to Evaluate | Lighting, a colour cast or image quality hides the true colour |

This is the dimension on which reviewers differ most. A difference of one band
between two reviewers is normal here and is not a mistake by either.

#### `formality`: does the garment match the formality the occasion expects?

Use this ladder: casual, smart casual, business casual, business formal,
formal. Too formal is as much a mismatch as too casual.

| Rating | Anchor |
|---|---|
| Excellent | On the level the occasion expects |
| Good | Close: about half a step more relaxed or more dressed up |
| Fair | A full step off. Other pieces would have to balance it |
| Poor | Two steps or more off, in either direction: a suit at the beach, athletic shorts at a business lunch |
| Unable to Evaluate | The cut or the length cannot be seen, so the level cannot be told |

#### `seasonality`: is the garment appropriate for the implied season?

The season comes from the occasion ("Summer Event", "Winter Event", "Beach") or
from what the images plainly show. Many occasions imply no season at all, such
as "Office Work". Then the honest rating is `Unable to Evaluate`. Do not use the
date of your review, and do not guess at fabric weight that cannot be seen.

| Rating | Anchor |
|---|---|
| Excellent | Weight and coverage clearly suit the implied season |
| Good | Workable, with a small trade-off in coverage or weight |
| Fair | Only partly suited |
| Poor | Clearly wrong for the season: a heavy overcoat at a summer event |
| Unable to Evaluate | No season can be inferred, or the weight of the garment cannot be told |

#### `style`: does the garment align with the stated style preference?

The stated preference is the case's `style_profile` (preferred styles and
favourite colours) and, where the case sends a Style DNA profile, its style
keywords. See the note below this section before rating it.

| Rating | Anchor |
|---|---|
| Excellent | Squarely within the stated styles |
| Good | Broadly in line with them |
| Fair | Reflects them only in part |
| Poor | Points in a different direction |
| Unable to Evaluate | The case states no style preference |

#### `style_preference_match`: does the garment conflict with the stated style preference?

This dimension is about conflict. Ask whether the person who stated these
preferences would be surprised by the garment.

| Rating | Anchor |
|---|---|
| Excellent | No conflict. It fits the stated styles and colours |
| Good | No real conflict. A small departure, such as a colour outside the favourites |
| Fair | A partial conflict: one element goes against the stated preference |
| Poor | A direct conflict: a bold all-over print for someone who asked for minimal, plain pieces |
| Unable to Evaluate | The case states no style preference |

**Note on `style`.** The system prompt defines `style` and
`style_preference_match` in almost the same words, while the product calls
`style` "Style consistency" and gives it no weight in the verdict. Until the
prompt is clarified, rate `style` exactly as the prompt asks. Expect the two
dimensions to agree closely, and treat that as a property of the current prompt.

You do not review confidence. The evaluation compares the confidence the model
states with how often its ratings agree with yours.

### Garment facts (every garment mode)

Record, for each garment image in order (`item` is the image number), what you
can see. These are compared with the model's `observations` (analysis-output/3)
and, for outfits, with its per-item notes. Record only what the image shows;
leave a field out rather than guess.

| Field | What to write |
|---|---|
| `garment_type` | `top`, `bottom`, `outerwear`, `dress`, `footwear`, `accessory`, `suiting` or `traditional_wear` |
| `identifiable: false` | Instead of `garment_type`, when you cannot tell what the garment is from this image. The model is expected to abstain |
| `colours` | `{ "dominant": [...], "secondary": [...] }` in the broad families the model uses: black, white, cream, grey, beige, brown, red, pink, orange, yellow, green, blue, navy, purple, gold, silver, multicolour. One or two dominant, at most three in all |
| `colour_visible: false` | Instead of `colours`, when lighting or occlusion means the colour cannot be judged |
| `pattern_category` | `solid`, `striped`, `checked`, `printed`, `textured`, `other`, or `unclear` when it cannot be judged |
| `visible_details` | Words that name details you can see (for example `lapel`, `pocket`). A model detail mentioning one counts as supported |
| `absent_details` | Words that name details that are NOT there (for example `hood` on a blazer). A model detail mentioning one counts as contradicted |

For views of one garment, also set `views_same_garment` on the reference:
`yes` when the views show the same garment, `no` when they do not. The free-text
`colour_family` and `pattern` fields of the first format are kept and never scored.

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

The plan already contains ten such pairs, `gv-g01-single` with `gv-g01-views`
up to `g10`. The stub generator does not write a comparison group, so add
`"comparison_group": "g01"` (and so on) to both references of each pair;
`references.template.json` shows where it goes.

## Second reviews and disagreements

One reviewer's ratings are one person's judgement. Used alone, every place
where a model differs from that person looks like a model error, including the
places where another careful reviewer would have differed too. A second review
makes that visible.

### What a second review is

The same case, rated again by another person who has not seen the first
ratings and has not seen any model output. It is stored next to the first
review in `second_reviews`. Both stay as they were given.

### How to do one

1. The person who keeps the dataset makes a blind sheet. It contains the inputs
   of each finished case and nothing the first reviewer concluded: the
   occasion, the style preferences, the Style DNA context where the case sends
   a profile (in the words the model is given), the garment mode, and the image
   paths with the hash of each file the first review recorded:

   ```bash
   npm run eval:second-review -- sheet --manifest evaluation/datasets/golden-v1/cases.json --references evaluation/datasets/golden-v1/references.json --out benchmark/data/golden-v1/second-review.json
   ```

   Add `--cases id,id` to cover only some cases. The sheet is written under
   `benchmark/data/`, which is git-ignored, because it is a working file.

2. The second reviewer opens the images, fills in their identifier, the date
   and six ratings per case, using the rubric above. They do not open
   `references.json`.

3. The person who keeps the dataset adds the sheet to the reference set. The
   second reviewer does not run this step: the command prints the earlier
   ratings wherever the reviews differ. Without `--write` it only prints what
   it would add:

   ```bash
   npm run eval:second-review -- merge --sheet benchmark/data/golden-v1/second-review.json --references evaluation/datasets/golden-v1/references.json --write
   ```

   The merge refuses a sheet that is incomplete, was made for another dataset
   or for other image files, names a case twice, or would exceed a limit of the
   reference format. It adds a sheet completely or not at all.

4. Bump `dataset_version` and run the validator (step 5 above). Adding a
   second review changes no first review, so reports from before and after it
   are still compared metric by metric: only the figures that use second
   reviews are held back until both reports have the same ones.

### What to do about a difference

Nothing, to the ratings. This is the rule that matters most:

- **Never change a rating to make two reviews agree.** A difference is a
  finding about how subjective that dimension is for that case.
- Talk about it if you like, and write what you concluded in the second
  review's `notes` ("we agree the hem is not visible; one of us read the dress
  as knee length"). The ratings stay.
- If one of you made a plain mistake, such as rating the wrong image, correct
  that review, say so in `review_notes`, and bump `dataset_version`.

### How a report uses it

- **Agreement between reviewers**, per dimension: how often two reviewers gave
  the same rating, a rating within one band, and how far apart they were on
  average. Agreement between a model and one reviewer cannot mean more than
  this does. If two people agree on `color` in 6 cases out of 10, a model that
  agrees with the first of them in 6 out of 10 is not shown to be worse than a
  person.
- **Every case reviewers differ on** is listed, with the dimensions, and marked
  where they are far apart: two bands or more, or one of them could not judge.
- **Model within the reviewers' range**: how often the model's rating is one a
  reviewer gave, or lies between two reviewers' ratings. Where reviewers
  differ, a rating inside their range is not an error.
- The report says in plain words when no case has a second review, so that a
  single reviewer's ratings are never read as settled.

The figures that compare a model with a reference still use the first review.
Which review counts as first is not a statement about who is right.

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
| 10 or more cases of one garment mode | The figures for that mode count as measured. The plan has 21 single, 12 multi-view and 12 outfit cases for this reason |
| 10 or more cases of one Style DNA condition behind a figure | That figure is also reported for the condition on its own. With fewer it is unavailable for that condition, and only the figure labelled pooled exists |
| 10 or more outfit cases | Garment type accuracy and outfit note completeness count as measured |
| 10 or more comparison groups | One photo against several counts as measured |
| 10 or more cases with a second review | Agreement between reviewers, and the model's position within their range, count as measured |
| 10 or more cases that send Style DNA and return ratings | Shopping Advisor availability counts as measured. The mistargeted figure needs ten such cases with a usable block and a dimension below Excellent; the unrequested figure counts cases without Style DNA |

Every count is a count of cases. Running a case three times, or an outfit of
three items, does not add to it. An abstaining case (no person, no garment)
produces no ratings, so it adds to validity and abstention figures and not to
agreement.

The minimum is ten units per figure, and a difference between two reports counts
only when it exceeds the noise margin (`evaluation/README.md`). Thirty to fifty
cases spread over the three garment modes is a sensible first target; ten cases
of one kind tell you about that kind only.

## Keeping it honest

- A reference is changed only to correct a mistake in the review. Say what
  changed in `review_notes` and bump `dataset_version`. Never adjust a rating
  because the model disagreed, and never because another reviewer did.
- A rating is not ground truth in the sense a measurement is. Report agreement
  as "agreement with the reviewer", next to how far reviewers agree with each
  other, and never as "accuracy" without that context.
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
