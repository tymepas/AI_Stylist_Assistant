# Hardening proposals awaiting approval

Three changes that were investigated and held back because each needed a decision first. **Proposal 1 has since been approved and implemented**; see "Server-side image intake" in `memory/ARCHITECTURE.md`, which describes the code as built. Proposals 2 and 3 are not implemented.

| # | Proposal | Why it needs approval |
|---|---|---|
| 1 | Server-side image normalisation | Adds `sharp` as a direct dependency and changes what is sent to the model provider |
| 2 | Confidence-aware report and structured observations | Changes the report's behaviour, and (part B) the prompt and the output schema |
| 3 | Typed fashion knowledge modules | Starts with an occasion allowlist, which changes which API requests are accepted |

---

## 1. Server-side image normalisation (implemented)

### Current state (verified)

- `validateImageFile` (`lib/services/analysisService.ts`) checks the declared MIME type, the size (10 MB) and the width and height read from the file **header**. It never decodes the image. The test fixtures show the consequence: a 33-byte file with a valid PNG header passes validation.
- `fileToDataUrl` (`lib/services/openai/openAIAnalysisService.ts`, `openAIProfileService.ts`) base64-encodes the original bytes and sends them to OpenAI. A client that bypasses the browser can therefore send EXIF and GPS metadata, an image of any pixel count that fits in 10 MB, or bytes that are not an image at all.
- There is no cap on width, height or total pixels, and no explicit request-size check (Vercel's 4.5 MB body limit is the only one, and only on Vercel).
- Since PR #4 the browser re-encodes every photo, so ordinary users already send small, metadata-free JPEGs. This proposal is about direct API clients and defence in depth.

### Proposed pipeline

For each uploaded image, before any spend reservation:

1. **Request size.** Reject a `Content-Length` above 4.5 MB with 413 before reading the body.
2. **Signature.** Keep the existing header check (JPEG, PNG, WEBP only). Reject everything else with the existing 400 message.
3. **Header limits.** From the header dimensions: each side between 512 and 8,192 px, and at most 16 megapixels. Reject otherwise with a specific 400 message. This runs before decoding, so an oversized image costs nothing.
4. **Decode and re-encode** with `sharp`:
   - `limitInputPixels: 16_000_000`, `failOn: 'error'`, `sequentialRead: true`, first frame only;
   - `.rotate()` to apply the EXIF orientation;
   - `.resize({ width: 1536, height: 1536, fit: 'inside', withoutEnlargement: true })`;
   - `.flatten({ background: '#ffffff' })`, then `.jpeg({ quality: 85 })`;
   - no `withMetadata()`, so EXIF, GPS and colour profiles are dropped.
5. **Send only the re-encoded JPEG** to the provider. The original bytes are never forwarded.
6. **Resource limits.** `sharp.cache(false)`, `sharp.concurrency(1)`, a decode timeout, and the two images of one request processed one after the other. The spend guard's global concurrency cap (2) already bounds how many requests decode at once.

A decode failure returns 400 "not a valid image" and the model is never called.

### Dependency assessment: `sharp`

| Question | Finding |
|---|---|
| Already present? | Only as an optional dependency of Next.js (`package-lock.json`). Add it to `dependencies` pinned to exactly 0.35.5, which guarantees it is installed. Do not use 0.34.5: it has published security advisories, all fixed by 0.35.5. |
| Licence and cost | Apache-2.0, free. |
| Size | About 0.6 MB of JavaScript plus a prebuilt native binary per platform (20 MB on Windows locally). It runs only on the server; the browser bundle is unaffected. |
| Vercel compatibility | Vercel's Node.js runtime supports `sharp`, and Next.js uses it for its own image optimisation. Not verified on this project's deployment; the first Preview build would confirm it. |
| `output: 'standalone'` | The native binary must be included by file tracing. To be checked in the Preview build. |
| Security | Native code (libvips). Mitigations: only three input formats accepted, pixel limit, strict failure mode, version pinned and updated through the lockfile. |
| Alternatives considered | A pure JavaScript decoder (slow, more memory, less maintained); WebAssembly codecs (unmaintained wrappers). Neither is better. |

### Consequences

- **Tests.** Route tests currently upload header-only fixtures (`makePng` in `tests/helpers/fixtures.ts`). With real decoding those must become real, tiny images generated in the test helper. Six route test files are affected. No assertion needs weakening.
- **Latency.** One decode and encode per image; expected to be small next to the model call, but not measured.
- **Memory.** A 16-megapixel RGBA image is 64 MB while decoded. Images from the Verdict frontend are about 2 megapixels.
- **Spend reservation.** After normalisation every image is at most 1,536 px on its long edge, which makes the per-image token bound in `modelConfig.ts` provable rather than assumed. No pricing value changes in this proposal.

### Suggested split

- **B1 (no new dependency):** request-size check and header limits. Small, safe, can be done at once.
- **B2:** `sharp` normalisation and the test fixture change.

---

## 2. Confidence-aware report and structured observations

### Current state (verified)

- Each dimension has a `confidence` of High, Medium or Low. It is validated (`openAIAnalysisSchema.ts`) and displayed (`ConfidenceMeter` in `DecisionReport.tsx`), and nothing else: `computeVerdict` (`lib/services/analysisService.ts`) does not read it.
- A dimension rated "Unable to Evaluate" is dropped and the remaining weights are rescaled. A verdict can therefore be computed from a single dimension, and the report gives no sign of it.
- `memory/ARCHITECTURE.md` lists "Low confidence across dimensions → limited report with a visible low confidence note" as a failure state. It is not implemented.
- The one confidence value per dimension mixes two different things: whether the garment could be seen, and how sure the model is that it suits the occasion.

### Part A: confidence-aware report (no prompt or model schema change)

A deterministic `evidence` summary computed by the application from the existing output. The verdict score and band are computed exactly as today and are never changed by it.

| Value | Definition |
|---|---|
| `coverage` | Sum of the weights of the dimensions that were rated (not "Unable to Evaluate"). 1.0 when all five weighted dimensions were rated. |
| `low_confidence_weight` | Sum of the weights of rated dimensions whose confidence is Low. |
| `report_state` | `full`, `limited` or `insufficient`, from the rules below. |

| State | Rule | What the user sees |
|---|---|---|
| `insufficient` | `occasion` and `formality` are both unrated, or `coverage` is below 0.5 | No band and no score. "Not enough could be evaluated", with the unrated dimensions listed and a prompt to retake the photo. |
| `limited` | Any weighted dimension is unrated, or `low_confidence_weight` is 0.3 or more, or `occasion` or `formality` is Low | The band, with a visible "limited information" note naming the dimensions concerned. The numeric score is hidden, to avoid suggesting precision that is not there. |
| `full` | Otherwise | As today. |

Model confidence only selects a state; it never moves the score. The thresholds (0.5 and 0.3) are a starting point to be checked against replayed recordings before release.

**Needs approval because** the `insufficient` state withholds a band that is shown today.

Tests: unit tests for every rule and boundary; a property test that `evidence` never changes `verdict_score` or `overall_recommendation`; component tests for the three states. Evaluation: how often each state occurs in a replayed recording, and whether `limited` cases are the unstable ones.

### Part B: structured observations (prompt and schema change)

Proposed addition to the model output, validated separately from the core analysis in the same way as `shopping_advisor`, so a malformed block can never invalidate the ratings:

```json
"observations": {
  "garment": {
    "category": "top | bottom | outerwear | dress | footwear | accessory | suiting | traditional_wear | unknown",
    "primary_colour": "<colour family> | unknown",
    "pattern": "solid | stripe | check | floral | graphic | other | unknown",
    "visible_details": ["up to 5 strings of at most 60 characters"]
  },
  "image_quality": { "person": "good | acceptable | poor", "garment": "good | acceptable | poor" },
  "visibility_confidence": "High | Medium | Low",
  "uncertainty_reasons": ["blur | occlusion | lighting | low_resolution | multiple_garments | colour_cast | other"]
}
```

- **Two kinds of confidence.** `visibility_confidence` and `image_quality` say how well the garment could be seen. The existing per-dimension `confidence` then means confidence in the style judgement.
- **A key detail is not visible.** If `category` is `unknown` or `visibility_confidence` is Low, the report state is at most `limited`.
- **Validation.** Enumerations everywhere except `visible_details`, which is length-capped and screened with the existing prohibited-statement patterns before display. Observations are never used unless they pass validation.
- **Backward compatibility.** `observations` is optional. Outputs and recordings without it stay valid; the report then behaves as in Part A. The schema version becomes `analysis-output/2`; the prompt version changes by itself.
- **Tests.** Schema tests, an isolation test (bad observations never affect the verdict), route and component tests, and the version guard tests.
- **Evaluation.** Attribute accuracy against verified labels becomes measurable. Before release: replay the old and new prompt on the same dataset and compare band agreement, stability and validity; that requires one authorised live benchmark run per prompt.
- **Cost.** Estimated 80 to 150 extra output tokens and 200 to 300 extra input tokens per analysis. At Terra's configured prices ($5 and $1 per million) that is about $0.0004 to $0.0011 per analysis. The worst-case reservation is unchanged while the output cap stays at 4,000. These are estimates, not measurements; the incomplete-response rate must be checked in the benchmark.

---

## 3. Typed fashion knowledge modules

### Assessment

| Option | Verdict | Reason |
|---|---|---|
| Curated TypeScript data | Use | The knowledge is small (tens of occasions, under ten garment categories, about a dozen colour families), changes rarely, and benefits from review and version control. |
| Relational or document store | Not yet | Nothing is persisted server-side. Becomes relevant with opt-in history or a wardrobe. |
| Vector retrieval | No | There is no corpus to retrieve from and no similarity requirement. |
| Knowledge graph | No | Every relationship needed is a one-step lookup (occasion to expected formality). |
| LangChain, LangGraph, agents | No | One model call per request, no branching, no tools. |

### What is justified now

- **`lib/knowledge/occasions.ts`.** The occasion list already exists as UI constants (`lib/constants/options.ts`). Moving it to a typed module with an id per occasion lets the API accept only known occasions. Today the server accepts any string up to 64 characters and places it in the prompt, which is the largest remaining untrusted-text path. **Needs approval because** unknown occasions would be rejected with 400, and several existing tests send arbitrary occasion strings on purpose.

### What should wait for Proposal 2

- `lib/knowledge/garments.ts`, `colours.ts`, `patterns.ts`: the enumerations that observations, evaluation labels and the shopping advisor would share. The garment categories already exist in `shoppingRecommendationSchema.ts`.
- `lib/knowledge/dress-codes.ts`: the formality range usually expected for each occasion.

### Rules for the knowledge layer

- Pure data and lookup functions, with a `KNOWLEDGE_VERSION` recorded in evaluation reports.
- Used for validation, labels, enumerations and wording.
- It never changes a rating, a weight, the score or the band, and never overrides a user's stated preference. If it is ever used to add an advisory note (for example "this occasion usually expects business formal"), the note is labelled as general guidance and is shown beside the verdict, not folded into it.
