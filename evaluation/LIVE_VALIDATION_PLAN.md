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
(written by `npm run eval:build-golden-plan`). It has **41 cases**, with at
least ten in each garment mode:

| Group | Cases | Garment mode | What it answers |
|---|---|---|---|
| Garments `g01` to `g10`, one photo: five clear matches, five clear mismatches | 10 | single | Baseline behaviour on unambiguous fits |
| The same ten garments, two or three views (`comparison_group`) | 10 | views of one garment | Whether extra views change the ratings, and in which direction |
| Outfits of two or three items, the garment type of each item recorded | 10 | outfit items | Per-item notes: present, one per image, garment types correct |
| Borderline fits | 2 | single | Ratings near a band boundary; expect reviewers to differ by one band |
| Image quality: warm indoor light, blur, part of the garment hidden | 3 | single | Whether uncertainty is stated (Low confidence or "Unable to Evaluate") rather than guessed |
| Ambiguous detail: colours that are hard to tell apart, fabric weight that cannot be told | 2 | single | Unsupported claims; list the hidden details in `unverifiable_terms` |
| Text in the image: a price or brand tag, a slogan that reads as an instruction | 2 | single | Tag text is not repeated; instructions are not followed |
| Insufficient input: no person, no garment | 2 | single | The model abstains |
| **Total** | **41** | 21 single, 10 views, 10 outfits | |

**Cases are not images.** These 41 cases need 111 image slots (41 personal
photos and 70 garment images), which are 91 different files because a pair
shares its files. Sample sizes count the 41 cases. Images matter for cost and
for sourcing only.

Twelve of the 41 cases send an invented Style DNA profile, four in each garment
mode, so that the Shopping Advisor is exercised on at least ten cases. Both
cases of a pair carry the same profile or neither does. The profiles are the
aesthetic-only personas in `scripts/evaluation/style-dna-personas.cjs`: no
personal profile is used, and colouring is left empty so that nothing
contradicts the real photo. The colouring part of Style DNA is therefore not
exercised by this run.

What this makes measurable, once all 41 are reviewed, and what it does not:

- **Measured (ten or more cases):** agreement per dimension over all cases; the
  figures of each garment mode; outfit note completeness and garment type
  accuracy; one photo against several (ten comparison groups); Shopping Advisor
  availability (twelve cases).
- **Too few to conclude:** abstention (two cases), text in the image (two),
  image quality (three), ambiguous detail (two), borderline fits (two). They
  are for reading case by case. Say so in any summary.
- The two insufficient-input cases produce no ratings, so 39 cases at most
  contribute to agreement figures.

## Runs

- Three runs per case, so that stability across runs can be measured. Two runs
  per case still measure stability and cost a third less (see below); one run
  measures none.
- One model and one reasoning setting: the production configuration. Comparing
  models or settings is a separate, separately approved run on the same manifest.
- Calls run one at a time. The runner stops before any call whose worst case
  could exceed the cap.

## Cost, from the configured pricing

Worst-case reservation per call (an upper bound, not expected spend):

| Garment images | Worst case per call |
|---|---|
| 1 | $0.0352 |
| 2 | $0.0388 |
| 3 | $0.0424 |

The 41 planned cases have 21 cases with one garment image, 11 with two and 9
with three. One run of all of them reserves at most
`21 x 0.0352 + 11 x 0.0388 + 9 x 0.0424 = $1.5476`.

| Runs per case | Calls | Worst case |
|---|---|---|
| 3 | 123 | **$4.64** |
| 2 | 82 | **$3.10** |

These are the figures the dry run prints for the plan, and a test pins them
(`tests/evaluation/balancedDatasets.test.ts`). An earlier version of this plan
had 37 cases and a worst case of $4.12; bringing every garment mode to ten
cases added four cases and about $0.52 at three runs. A Style DNA profile does
not change the reservation: it is text inside the fixed text allowance.

Use a cap of $5 for three runs, or $3.50 for two. The hard cap is $10 and is
not raised.

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
- Calls run one at a time. Before each call the runner adds that call's worst
  case to what was spent and stops if the sum would pass the cap. A call whose
  cost is unknown is counted at its worst case.
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

A result from 41 cases describes these 41 cases, this model and this prompt
version. It does not establish that the model is accurate in general.

## Stop conditions

Stop the run and do not retry without a new decision if:

- the valid output rate falls below 90% after the first ten calls;
- any call is answered with an incomplete response at the configured output cap;
- measured cost per call approaches the worst-case reservation, which would mean
  the per-image token bound is too low;
- the runner reports that it stopped before the cap.
