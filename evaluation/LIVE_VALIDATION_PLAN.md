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
| Real latency and token use with three and four images | **Not measured.** The per-image token bound for the configured model is an assumption with a 20% margin (`lib/services/openai/modelConfig.ts`) |

## Prerequisites

1. Human-reviewed cases exist in `evaluation/datasets/golden-v1/` and pass
   `npm run eval:references` with `--images` (`evaluation/HUMAN_REVIEW.md`).
2. The cases use `public_license` images. Model output for `owned` and
   `approved_volunteer` photos is withheld from recordings and is not scored
   (see "Decisions" in `HUMAN_REVIEW.md`).
3. A dry run of the exact manifest has printed the worst-case cost, and that
   figure is inside the approved cap.
4. Explicit approval for the run, naming the model, the number of runs per case
   and the spend cap.

## Cases to cover

Review each case blind, before any model output exists for it.

| Group | Cases | What it answers |
|---|---|---|
| Single garment, clear match | 5 | Baseline behaviour on unambiguous good fits |
| Single garment, clear mismatch | 5 | Baseline behaviour on unambiguous poor fits |
| Single garment, borderline | 3 | Ratings near a band boundary; expect disagreement within one band |
| Views of one garment | 5, each paired with a single-photo case of the same garment and occasion (`comparison_group`) | Whether extra views change the ratings, and in which direction |
| Outfit items | 5, with two or three items and the garment type of each item recorded | Per-item notes: present, one per image, garment types correct |
| Image quality | 5: warm indoor light, backlight, blur, low resolution near 512 px, part of the garment hidden | Whether uncertainty is stated (Low confidence or "Unable to Evaluate") rather than guessed |
| Ambiguous detail | 3: colours that are hard to tell apart, material that cannot be determined | Unsupported claims; list the hidden details in `unverifiable_terms` |
| Text in the image | 3: a price or brand tag, an instruction printed on the garment | Tag text is not repeated; instructions are not followed. Each names one of the single-garment cases above as its clean twin, so no extra case is needed |
| Insufficient input | 3: no person, no garment, unusable image | The model abstains |
| **Total** | **37** | |

Thirty-seven cases give at least ten per dimension for the agreement figures as
a whole. Every figure counts cases, so the groups of three and five are below
the minimum sample of ten: the five multi-view cases, the five outfit cases and
the five comparison groups will each read "too few to conclude". They are for
reading case by case, not for a conclusion. Say so in any summary. Measured
figures per image mode need ten cases of that mode.

## Runs

- Three runs per case, so that stability across runs can be measured.
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

For the 37 cases above at three runs, with five two-view cases and five outfit
cases counted at three garment images each: at most
`(27 x 0.0352 + 10 x 0.0424) x 3 = $4.12`. Use a cap of $5 for this run. The
hard cap is $10 and is not raised.

These figures follow the pricing table in the code, last checked against the
provider on the date stated there. Confirm the provider's current prices before
the run. The dry run prints the exact worst case for the actual manifest.

## Commands

Dry run, free, no network access:

```bash
BENCHMARK_MODEL=gpt-6.1-terra BENCHMARK_CASES=evaluation/datasets/golden-v1/cases.json BENCHMARK_DATA_DIR=benchmark/data/golden-v1 npm run benchmark
```

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
| Confidence against agreement | Report, section 7 |
| Results per garment mode, outfit note completeness, garment type accuracy, one photo against several | Report, section 8 |
| Mentioned and missing facts, contradictions, unsupported details | Report, section 9 (proxy) |
| Abstention on insufficient input, text-in-image cases | Report, sections 4 and 10 |
| Latency, tokens, cost | Report, section 3, and the run record |
| Model, prompt version, schema version, dataset and reference fingerprints | Run record |

## How to read the result

Keep these apart in any write-up:

- **Measured against human-reviewed images**: section 5 and the human-reviewed
  parts of sections 7 and 8, with their sample sizes.
- **Measured without a reference**: validity, stability, latency, cost.
- **Proxies**: grounding. Read the flagged cases.
- **Too few to conclude**: any figure marked so. Report it as such.
- **Not measured**: colour, pattern and single-garment identification, and
  contradictions between views. The output has no field for them.

A result from 37 cases describes these 37 cases, this model and this prompt
version. It does not establish that the model is accurate in general.

## Stop conditions

Stop the run and do not retry without a new decision if:

- the valid output rate falls below 90% after the first ten calls;
- any call is answered with an incomplete response at the configured output cap;
- measured cost per call approaches the worst-case reservation, which would mean
  the per-image token bound is too low;
- the runner reports that it stopped before the cap.
