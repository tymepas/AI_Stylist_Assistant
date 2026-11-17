# Verdict model benchmark

Compares GPT-4.1 (baseline) with GPT-6.1 Terra (candidate) on the same images,
prompts, schemas and deterministic verdict engine as production.

**By default nothing is sent to OpenAI.** A run is a dry run unless you opt in
explicitly and set a spend cap.

## 1. Prepare data (never real customer photos)

1. Copy `benchmark/cases.example.json` to `benchmark/cases.json` and edit it.
2. Put images under `benchmark/data/` using the relative paths in the manifest.
3. Use only synthetic images, photos you own, images under a licence that allows
   this use, or photos from volunteers who approved this use. Record which in
   each case's `source` field.

`benchmark/data/` and `benchmark/results/` are git-ignored. Do not commit them.

The example manifest covers every required category: clear photos, lighting,
camera angle, resolution, EXIF rotation, single and multiple garments, blur,
occlusion, difficult colours, ambiguous details, instructions printed on a
garment, product claims on a tag, and an insufficient-input case.

## 2. Dry run (free)

```bash
BENCHMARK_MODEL=gpt-6.1-terra npm run benchmark
```

Validates the manifest and every image, then prints the worst-case cost, with
each case priced at its own number of images. Network access is disabled inside
the run.

For the human-reviewed golden dataset, point the same command at its manifest
and image directory (see `evaluation/HUMAN_REVIEW.md`):

```bash
BENCHMARK_MODEL=gpt-6.1-terra BENCHMARK_CASES=evaluation/datasets/golden-v1/cases.json BENCHMARK_DATA_DIR=benchmark/data/golden-v1 npm run benchmark
```

## 3. Live run (billable; needs separate approval)

```bash
BENCHMARK_MODEL=gpt-4.1 BENCHMARK_LIVE=I_ACCEPT_OPENAI_CHARGES BENCHMARK_MAX_USD=2 npm run benchmark
```

```bash
BENCHMARK_MODEL=gpt-6.1-terra BENCHMARK_REASONING_EFFORT=low BENCHMARK_LIVE=I_ACCEPT_OPENAI_CHARGES BENCHMARK_MAX_USD=3 npm run benchmark
```

| Variable | Meaning | Default |
|---|---|---|
| `BENCHMARK_MODEL` | `gpt-4.1` or `gpt-6.1-terra` (required) | — |
| `BENCHMARK_REASONING_EFFORT` | Terra only: `none`, `low`, `medium` | model default (`low`) |
| `BENCHMARK_MAX_OUTPUT_TOKENS` | 500–32000 | model default |
| `BENCHMARK_RUNS` | Runs per case, 1–5 | 3 |
| `BENCHMARK_MAX_USD` | Spend cap for this run, at most $10 | required for live |
| `BENCHMARK_LIVE` | Must be exactly `I_ACCEPT_OPENAI_CHARGES` | dry run |
| `BENCHMARK_CASES` / `BENCHMARK_DATA_DIR` | Manifest and image directory | `benchmark/cases.json`, `benchmark/data` |

**Safety rules built into the runner:**
- It refuses live mode in CI, on Vercel or with `NODE_ENV=production`.
- Calls run one at a time, never in parallel.
- It stops before any call whose worst-case cost could exceed `BENCHMARK_MAX_USD`; unknown outcomes are counted at the worst case.
- It reads `OPENAI_API_KEY` from the environment or `.env.local` and never prints it.
- It ignores `OPENAI_MODEL` in `.env.local`, so local development stays on GPT-4.1.

## 4. Review

Each live run writes three files to `benchmark/results/`:
- `<timestamp>-<model>-<effort>.json`: settings, prompt and schema versions, summary metrics and every run record.
- `<timestamp>-<model>-<effort>.review.csv`: a sheet for human review.
- `<timestamp>-<model>-<effort>.recording.json`: the model outputs, for free replay with `npm run eval` (see `evaluation/README.md`). Outputs for `owned` and `approved_volunteer` photos are withheld.

In the review sheet, a reviewer marks hallucinations against each case's
`key_facts` and confirms or dismisses screening hits.

To score a recording against human-reviewed references (per-dimension agreement,
grounding, confidence calibration, image modes), replay it with a reference set.
Replay is free and repeatable:

```bash
npm run eval:replay -- --manifest <cases.json> --references <references.json> --recording benchmark/results/<file>.recording.json
```

Automated metrics are:
- valid structured output rate;
- incomplete responses;
- verdict band agreement;
- consistency across runs;
- correct abstention and false abstention;
- screening hits for prohibited statements and case-specific forbidden claims;
- verdict-band changes on adversarial cases;
- p50 and p95 latency, token usage, and cost.

`evaluateAcceptance()` in `benchmark/harness.ts` applies the agreed acceptance criteria to a candidate and a baseline summary.
