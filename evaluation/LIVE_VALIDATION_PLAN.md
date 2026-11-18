# Live validation plan

**Status: a plan. Nothing in it has been run.** No live model call has been made
for this plan, and none is made without explicit approval for that run.

It answers one question that mock tests cannot: how does the configured model
actually behave on real images, in each garment mode? Everything built so far
about the multi-image modes was built against mocks and synthetic fixtures.

## What is and is not known today

| Statement | Evidence |
|---|---|
| The request for each garment mode is built as intended | Verified by tests |
| Images are validated, decoded and re-encoded on Production | Verified on Production without a model call (`npm run verify:image-intake`) |
| The verdict is computed only from the six ratings | Verified by tests |
| The model returns valid output for two to four images | **Not measured** |
| The model rates multi-view and outfit inputs sensibly | **Not measured** |
| The model returns per-item notes that match the images | **Not measured** |
| Agreement with a human reviewer, per dimension | **Not measured.** The golden dataset is empty |
| Agreement between two human reviewers | **Not measured.** No case has been reviewed, by anyone |
| The Shopping Advisor returns usable alternatives when Style DNA is sent | **Not measured.** Verified against hand-written outputs only |
| Real latency and token use with three and four images | **Not measured.** The per-image token bound for the configured model is an assumption with a 20% margin (`lib/services/openai/modelConfig.ts`) |

## Prerequisites

1. Human-reviewed cases exist in `evaluation/datasets/golden-v1/` and pass
   `npm run eval:references` with `--images` (`evaluation/HUMAN_REVIEW.md`).
2. The cases use `public_license` images. Model output for `owned` and
   `approved_volunteer` photos is withheld from recordings and is not scored
   (see "Decisions" in `HUMAN_REVIEW.md`).
3. Every garment mode has at least ten image-reviewed cases. The validator
   prints this. Below ten, the figures for that mode read "too few to conclude".
4. At least ten cases were rated by a second person, independently
   (`HUMAN_REVIEW.md`, "Second reviews and disagreements"). Without that, a
   difference between the model and the reviewer cannot be told apart from a
   difference between two reviewers.
5. A dry run of the exact manifest has printed the worst-case cost, and that
   figure is inside the approved cap.
6. Explicit approval for the run, naming the model, the number of runs per case
   and the spend cap. See "What an approval request must state" below.

## Cases to cover

Review each case blind, before any model output exists for it.

The plan is committed as `evaluation/datasets/golden-v1/cases.template.json`
(written by `npm run eval:build-golden-plan`). It has **45 cases**: at least
ten in each garment mode, and two reserve cases in each multi-image mode.
`evaluation/datasets/golden-v1/CASE_MATRIX.md` lists every case with its mode,
images, Style DNA, expected abstention and how its results are reported.

| Group | Cases | Garment mode | What it answers |
|---|---|---|---|
| Garments `g01` to `g10`, one photo: five clear matches, five clear mismatches | 10 | single | Baseline behaviour on unambiguous fits |
| The same ten garments, two or three views (`comparison_group`) | 10 | views of one garment | Whether extra views change the ratings, and in which direction |
| Outfits of two or three items, the garment type of each item recorded | 10 | outfit items | Per-item notes: present, one per image, garment types correct |
| Reserve: two further garments as two views each, no single-photo twin | 2 | views of one garment | Margin: one failed case no longer costs the mode its figures |
| Reserve: two further outfits of two items each | 2 | outfit items | The same, for outfits |
| Borderline fits | 2 | single | Ratings near a band boundary; expect reviewers to differ by one band |
| Image quality: warm indoor light, blur, part of the garment hidden | 3 | single | Whether uncertainty is stated (Low confidence or "Unable to Evaluate") rather than guessed |
| Ambiguous detail: colours that are hard to tell apart, fabric weight that cannot be told | 2 | single | Unsupported claims; list the hidden details in `unverifiable_terms` |
| Text in the image: a price or brand tag, a slogan that reads as an instruction | 2 | single | Tag text is not repeated; instructions are not followed |
| Insufficient input: no person, no garment | 2 | single | The model abstains |
| **Total** | **45** | 21 single, 12 views, 12 outfits | |

**Cases are not images.** These 45 cases need 123 image slots (45 personal
photos and 78 garment images), which are 103 different files because a pair
shares its files. Sample sizes count the 45 cases. Images matter for cost and
for sourcing only.

**Style DNA is a condition on a case, not a garment mode.** Fourteen of the 45
cases send an invented Style DNA profile: six single, four multi-view and four
outfits. Each is counted in exactly one garment mode, and the mode totals add
up to 45 with them and to 31 without them. Both cases of a pair carry the same
profile or neither does; the validator refuses a pair that differs. The
profiles are the aesthetic-only personas in
`scripts/evaluation/style-dna-personas.cjs`: no personal profile is used, and
colouring is left empty so that nothing contradicts the real photo. The
colouring part of Style DNA is therefore not exercised by this run.

What this can make measurable, once all 45 are reviewed, and under which
conditions:

- **Ten or more cases, with margin:** agreement per dimension over all cases (43
  cases can give ratings); the single-garment figures (19 cases); the figures
  of each multi-image mode, outfit note completeness and garment type accuracy
  (12 cases each, so one case without a complete output still leaves 11).
- **Exactly ten, no margin:** one photo against several (ten comparison pairs).
  A reserve case has no single-photo twin. If one pair lacks a complete output
  on either side, that figure reads "too few to conclude".
- **Shopping Advisor availability:** fourteen cases, which are ten different
  photo-and-garment combinations, because four of them are the second half of
  a pair.
- **Too few to conclude, whatever happens:** abstention (two cases), text in the
  image (two), image quality (three), ambiguous detail (two), borderline fits
  (two). They are for reading case by case. Say so in any summary.

### How Style DNA is reported

A profile changes what the model is told, so cases with and without one are
never mixed silently. A report does three things:

1. It labels every figure that combines both conditions as **pooled**.
2. It reports the same figure **separately** for each condition wherever at
   least ten cases of that condition stand behind it.
3. Where a condition has fewer, its separate figure is **unavailable**. It is
   not shown as a small-sample value next to the pooled one.

For this plan, with every case reviewed and every output complete:

| Figure | Without Style DNA | With Style DNA | Both together |
|---|---|---|---|
| All cases that give ratings | 29: separate figure | 14: separate figure | 43: pooled, labelled |
| Single garment | 13: separate figure | 6: unavailable | 19: pooled, labelled |
| Views of one garment | 8: unavailable | 4: unavailable | 12: pooled, labelled |
| Outfit items | 8: unavailable | 4: unavailable | 12: pooled, labelled |
| Comparison pairs | 6 pairs: unavailable | 4 pairs: unavailable | 10 pairs: pooled, labelled |

So the effect of Style DNA can be read overall, and for single garments on the
"without" side only. It cannot be read within either multi-image mode from
this plan: those figures exist only pooled. A test evaluates a fully reviewed
copy of the plan in memory and checks that a report says exactly this
(`tests/evaluation/styleDnaConditions.test.ts`).

Two more things a reader of the result must be told:

1. **Pairs are not independent.** The two cases of a pair share photo, garment
   and occasion. The 43 cases that can give ratings are 33 different
   combinations, so the standard errors of pooled figures are somewhat too
   narrow.
2. **A reference rating is one person's judgement.** See prerequisite 4.

### Options that cost more

Not part of the plan as committed. Each is a decision about scope and cost.

| Option | What it buys | Cases | Sum of reservations, 3 runs | 2 runs |
|---|---|---|---|---|
| The earlier plan, without reserve cases | Ten per mode and no margin | 41 | $4.64 | $3.10 |
| **The plan as committed** | Margin in both multi-image modes | **45** | **$5.11** | **$3.41** |
| Two more cases without Style DNA in each multi-image mode | A separate "without Style DNA" figure for each multi-image mode (ten cases each) | 49 | about $5.57 | about $3.72 |
| Style DNA as a second run of existing cases: all 45 cases without a profile, plus twelve of them repeated with one | The effect of Style DNA measured on the same images, and every mode at ten or more cases without a profile. No extra images | 57 | about $6.51 | about $4.34 |

The figures for the last two options are estimates from the per-call
reservations below, not dry-run output: neither manifest exists.

## Runs

- Three runs per case, so that stability across runs can be measured. Two runs
  per case still measure stability and cost a third less (see below); one run
  measures none.
- One model and one reasoning setting: the production configuration. Comparing
  models or settings is a separate, separately approved run on the same manifest.
- Calls run one at a time. The runner stops before any call whose worst case
  could exceed the cap.

## Cost, from the configured pricing

**What these figures are.** Before each call the runner reserves an amount
computed from bounds in the configuration. The figures below are sums of those
reservations. They are the most the run can cost *if the bounds hold*. They
are not a guaranteed maximum of what the provider bills, because one bound is
an assumption that has not been measured (see "Assumptions").

Every request carries one personal photo plus the garment images of the case:
two, three or four images. The reservation for one call is

```
(8,000 text tokens + 3,600 tokens x images) x $1 per million     input
+ 4,000 output tokens x $5 per million                           output
```

| Garment images | Images in the request | Input tokens reserved | Reservation per call |
|---|---|---|---|
| 1 | 2 | 8,000 + 7,200 = 15,200 | $0.0152 + $0.0200 = **$0.0352** |
| 2 | 3 | 8,000 + 10,800 = 18,800 | $0.0188 + $0.0200 = **$0.0388** |
| 3 | 4 | 8,000 + 14,400 = 22,400 | $0.0224 + $0.0200 = **$0.0424** |

### Assumptions

| Part | Bound | Status |
|---|---|---|
| Text | 8,000 tokens for everything that is not an image: the complete system prompt, the occasion, the style preferences, the Style DNA lines, the garment-mode and output-format instructions and the image labels | **Checked offline.** With the analysis-output/3 prompt (Phase 4 Milestone 1) the text of the 45 planned requests is 4,987 to 5,239 bytes (it was 4,414 to 5,270 with the earlier prompt), and a token is at least one byte. Tests hold the worst case the application accepts under the bound (`tests/spend/spendUnits.test.ts`, `tests/core/garmentModes.test.ts`). A few tokens of message framing added by the provider are not counted |
| Output | 4,000 tokens, sent as `max_output_tokens`. Reasoning tokens count inside it | **Enforced by the request.** The provider cannot return more |
| Image | 3,600 tokens per image: 3,000 plus a 20% margin, which is already included | **An assumption, not measured.** The 3,000 comes from the provider's documented rule for this model family at detail "high"; the configuration notes that the provider's vision guide does not list this model. If an image is billed at more than 3,600 tokens, a call costs more than its reservation |
| Prices | $1 per million input tokens, $5 per million output tokens, no caching discount assumed | From the provider's model pages as checked on 2026-11-16. To be checked again before any request for approval |
| Calls | One request per case per run. The client never retries | In the code (`lib/services/openai/responsesClient.ts`) |

Because of the image bound, treat the totals below as **reservations**, and rely
on the cap, not on the total, to limit spend (see "Spending controls").

### Totals for the plan

The 45 planned cases have 21 cases with one garment image, 15 with two and 9
with three. One run of all of them reserves
`21 x 0.0352 + 15 x 0.0388 + 9 x 0.0424 = $1.7028`.

| Runs per case | Calls | Sum of reservations |
|---|---|---|
| 3 | 135 | **$5.11** |
| 2 | 90 | **$3.41** |
| 1 | 45 | $1.70 |

The four reserve cases have two garment images each and add
`4 x 0.0388 = $0.1552` per run to the 41 cases of the earlier plan ($1.5476
per run, $4.64 at three runs, $3.10 at two).

These are the figures the dry run prints for the plan, and a test pins them
(`tests/evaluation/balancedDatasets.test.ts`). An earlier version of this plan
had 37 cases and reservations of $4.12; bringing every garment mode to ten
cases added four cases and about $0.52 at three runs. A Style DNA profile does
not change the reservation: it is text inside the fixed text allowance.

The difference between two and three runs per case is one run of all 45 cases:
45 calls and $1.70 in reservations. Two runs still measure stability
across runs; three give one more observation of it per case.

Three runs no longer fit under a cap of $5: the reservations come to $5.11, and
the runner would stop about three calls short. Use a cap of $5.50 for three
runs, or $3.75 for two. The hard cap is $10 and is not raised.

These figures follow the pricing table in the code
(`lib/services/openai/modelConfig.ts`: $1 per million input tokens and $5 per
million output tokens for the configured model, checked against the provider's
model pages on 2026-11-16). **Confirm the provider's current prices again
before asking for approval.** If a price or a token bound changed, the figures
above are wrong until the configuration is updated, which is its own change.

## What an approval request must state

A live run is never started on the strength of this document. The request for
approval states, for that one run:

1. The exact case count, taken from the dry run of the manifest as it is then,
   by garment mode, and the number of image-reviewed cases behind it.
2. The number of runs per case, and the resulting number of calls.
3. The date on which the provider's current prices were checked against the
   pricing table in the code, and the result.
4. The maximum projected cost printed by the dry run, and the cap requested.
5. The spending controls in force (next section).

## Spending controls

Built into the runner and covered by tests; none of them is changed by this plan:

- No call is made without `BENCHMARK_LIVE=I_ACCEPT_OPENAI_CHARGES` and a
  `BENCHMARK_MAX_USD` above zero. Without the phrase the command is a dry run
  with network access disabled.
- `BENCHMARK_MAX_USD` cannot exceed the hard cap of $10.
- Live mode is refused in CI, on Vercel and with `NODE_ENV=production`.
- Calls run one at a time. Before each call the runner adds that call's
  reservation to what was spent and stops if the sum would pass the cap. After
  a call it counts the cost from the usage the provider reported; a call whose
  usage is unknown is counted at its reservation.
- **What the cap does and does not guarantee.** It guarantees that the runner
  starts no call once the spend it has counted plus the next reservation would
  pass the cap. If a call costs more than its reservation, which can only
  happen if an image is billed above the assumed bound, the counted spend can
  end above the cap by that one call's excess, and no further call is made. The
  cap is enforced by this runner, not by the provider. A spending limit set on
  the provider's side is the only control that does not depend on these bounds;
  setting one is outside this repository.
- The first calls of a run show whether the image bound holds: the recording
  and the run record carry the tokens the provider reported for each call.
  A stop condition below covers it.
- The run uses the benchmark's own key handling and never touches the
  Production spend guard, its Redis store or any environment variable of the
  deployed application.

## Commands

Dry run, free, no network access:

```bash
BENCHMARK_MODEL=gpt-6.1-terra BENCHMARK_CASES=evaluation/datasets/golden-v1/cases.json BENCHMARK_DATA_DIR=benchmark/data/golden-v1 npm run benchmark
```

It prints the cases by garment mode, the images, the cases with Style DNA,
whether every mode has ten cases, and the worst-case cost. The same command
with `BENCHMARK_CASES=evaluation/datasets/golden-v1/cases.template.json` prices
the plan before any image exists; it then reports every image as missing.

Live run, **only after approval**. Billable:

```bash
BENCHMARK_MODEL=gpt-6.1-terra BENCHMARK_CASES=evaluation/datasets/golden-v1/cases.json BENCHMARK_DATA_DIR=benchmark/data/golden-v1 BENCHMARK_RUNS=3 BENCHMARK_LIVE=I_ACCEPT_OPENAI_CHARGES BENCHMARK_MAX_USD=5 npm run benchmark
```

Score the recording, free and repeatable:

```bash
npm run eval:replay -- --manifest evaluation/datasets/golden-v1/cases.json --references evaluation/datasets/golden-v1/references.json --images benchmark/data/golden-v1 --recording benchmark/results/<file>.recording.json
```

The commands above use shell syntax for setting variables. On Windows
PowerShell, set each variable with `$env:NAME = 'value'` first.

## What to record

The runner and the replay write these; nothing is typed by hand.

| Outcome | Where |
|---|---|
| Valid output rate, error codes, incomplete responses | Report, section 3 |
| Per-dimension agreement with the reviewer | Report, section 5 |
| Agreement between reviewers, cases they differ on, the model within their range | Report, section 5 |
| Each figure with and without Style DNA, next to the pooled figure | Report, section 8, "With and without Style DNA", and the metric index under `style_dna.` |
| Shopping Advisor: usable block with Style DNA, mistargeted and unrequested recommendations | Report, section 10 |
| Confidence against agreement | Report, section 7 |
| Results per garment mode, outfit note completeness, garment type accuracy, one photo against several | Report, section 8 |
| Mentioned and missing facts, contradictions, unsupported details | Report, section 9 (proxy) |
| Abstention on insufficient input, text-in-image cases | Report, sections 4 and 10 |
| Latency, tokens, cost | Report, section 3, and the run record |
| Model, prompt version, schema version, dataset and reference fingerprints | Run record |

## How to read the result

Keep these apart in any write-up:

- **Measured against human-reviewed images**: section 5 and the human-reviewed
  parts of sections 7 and 8, with their sample sizes. Read every agreement
  figure next to the agreement between reviewers for the same dimension: a
  reference rating is one person's judgement.
- **Measured without a reference**: validity, stability, latency, cost.
- **Proxies**: grounding. Read the flagged cases.
- **Too few to conclude**: any figure marked so. Report it as such.
- **Not measured**: colour, pattern and single-garment identification, and
  contradictions between views. The output has no field for them.

A result from 45 cases describes these 45 cases, this model and this prompt
version. It does not establish that the model is accurate in general.

## Stop conditions

Stop the run and do not retry without a new decision if:

- the valid output rate falls below 90% after the first ten calls;
- any call is answered with an incomplete response at the configured output cap;
- the input tokens the provider reports for a call come close to, or exceed, the
  input tokens reserved for it (15,200, 18,800 or 22,400 by number of images).
  That would mean the per-image token bound is too low, and that the totals
  above understate what the run can cost;
- the runner reports that it stopped before the cap.
