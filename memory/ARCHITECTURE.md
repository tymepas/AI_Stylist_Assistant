# Architecture

Frontend → Input Validation → Server Image Intake (decode, re-encode, strip metadata) → Single Multimodal AI Call → Core JSON Validation → Verdict Calculation (app code) → Independent Validation of Advisory Blocks (shopping advisor, outfit item notes) → Decision Report UI

## Stack
Next.js, TypeScript, Tailwind, shadcn/ui, Framer Motion.

## AI Requirements
Multimodal, JSON mode, low latency, reliable instruction following. Model name intentionally not fixed here, record the actual choice once selected: _(fill in)_

## Failure States

| Failure | User Experience |
|---|---|
| No person detected | Ask for a clearer full or upper body photo |
| No garment detected | Ask for a garment image with the full item visible |
| AI timeout | Show retry option, never a silent hang |
| Invalid JSON | Friendly generic error with retry; log the error category and schema issue paths only, never the raw response |
| Low confidence across dimensions | Show a limited report with a visible low confidence note |
| Image exceeds size/resolution limits | Reject at upload with a specific message |

No failure state should ever produce a broken UI or an unexplained spinner.

## Data Handling
Photos are sent to the model provider for analysis and not persisted beyond the request unless the user opts into history (future phase). Privacy language must be re-verified against the actual provider and retention policy before each release.

## Camera capture and browser image preparation

Photos are chosen with native file inputs only (`components/fashion/UploadCard.tsx`): one with a `capture` hint (front camera for the personal photo and Style DNA, rear camera for the garment) and a separate gallery/file input. Every garment slot has both. With several garment photos, each is prepared to a smaller target (about 0.7 MB) so that they fit one request together with the personal photo. There is no `getUserMedia` and no camera SDK.

Every chosen photo is prepared in the browser by `lib/images/prepareImageForUpload.ts` before it can be submitted:

| Step | Behaviour |
|---|---|
| Format check | Leading bytes must be JPEG, PNG or WEBP. HEIC/HEIF is detected and refused with a specific message; it is not converted. |
| Decode | Browser decoders, with EXIF orientation applied. Source files above 25 MB are refused. |
| Resize | Long edge reduced to 1,536 px. The short side is never reduced below 512 px, and an image that already fits is never enlarged. A source under 512 px is enlarged just enough (outfit analysis) or refused (Style DNA). |
| Encode | Always re-encoded as JPEG on a white background, so the original bytes and their metadata (EXIF, GPS) are never uploaded. |
| Size | Quality steps 0.86 → 0.62 aim for 1 MB per image; if none fits, dimensions shrink by 15% up to three times. Above 1.8 MB the image is refused. |
| Request budget | One request must stay within 4.0 MB, below Vercel's 4.5 MB body limit. |

Images are held in memory only: nothing is written to localStorage, sessionStorage or IndexedDB, preview object URLs are revoked when replaced, removed or unmounted, and nothing is uploaded until the user submits. Files are sent under generic names (`photo.jpg`, `garment.jpg`).

Uploads go through `lib/services/uploadRequest.ts`: one request per submission, no automatic retry, a 70-second client timeout (above the route's 60-second `maxDuration`), and distinct messages for offline, network failure and HTTP 400, 413, 429 and 503. Server-side validation in `lib/services/analysisService.ts` still applies to every request, and the server then decodes and re-encodes every image itself (see "Server-side image intake").

## Server-side image intake

Every uploaded image passes through `lib/services/uploadIntake.ts` and `lib/images/normalizeImage.ts` before anything else uses it, on both `/api/analyze` and `/api/generate-profile`, in mock mode as well as live mode. All of it runs before any spend reservation or model call, so a rejected upload costs nothing.

| Step | Behaviour |
|---|---|
| Request size | A declared `Content-Length` above 4.5 MB is refused with 413 before the body is read. The images of a parsed request are summed against the same limit, so a request without a usable header is checked too. |
| Header check | The existing header validation: JPEG, PNG or WEBP, at most 10 MB, at least 512 px on each side. |
| Content check | The leading bytes decide the format. A file whose content does not match its declared type is refused, as is any other format, whatever name or type it claims. |
| Pixel limits | At most 8,192 px on a side and 16 megapixels, checked from the header before any pixel is decoded, and enforced again by the decoder (`limitInputPixels`). |
| Decode | `sharp` with `failOn: 'error'`: a truncated or corrupt file is refused, not partly decoded. First frame only. A 10-second timeout. |
| Normalise | EXIF orientation applied; long edge reduced to 1,536 px, never enlarged; transparency flattened onto white; re-encoded as JPEG at quality 85. |
| Metadata | Nothing is carried over: EXIF, GPS, ICC and XMP are all dropped. |

Only the re-encoded JPEG is passed on. The uploaded bytes are never sent to the model provider. Processing is in memory: no temporary file is written, `sharp`'s cache is off, one decode runs at a time per process, and neither the input nor the output is logged. A failure in the image library is answered with 400 and no model call.

The browser still prepares every photo first (see above), so for photos from the Verdict frontend the server step resizes nothing and re-encodes once. It exists for clients that call the API directly, which could otherwise send metadata, a decompression bomb or bytes that are not an image. The benchmark runner applies the same normalisation, so a benchmark sends the model exactly what production sends.

`sharp` is a native module. `output: 'standalone'` traces it and its platform binary into the deployment; the first Preview build of a change in this area is what confirms that on Vercel.

## Garment modes: one garment, several views, or an outfit

An analysis has one personal photo and one to three garment photos. How the garment photos relate is the **garment mode** (`lib/constants/garmentModes.ts`), and it is always chosen by the user:

| Mode | Garment photos | Meaning |
|---|---|---|
| `single` | exactly 1 | One photo of the garment. The original behaviour. |
| `same_garment_views` | 2 or 3 | Different views of ONE garment (front, back, side). Combined evidence about a single item. |
| `outfit_items` | 2 or 3 | DIFFERENT items worn together (shirt, trousers, jacket). The six ratings are for the outfit as a whole. |

Rules that hold everywhere (API, UI, evaluation manifest, benchmark):

- **The mode is never inferred** from the number of photos, and a photo is never dropped to make a request fit. A count that does not fit the mode is an error with a message; in the UI, switching to one garment photo while several are added asks first.
- **Backward compatible.** `POST /api/analyze` takes the field `garment` one to three times and `garmentMode`. A request without `garmentMode` is a `single` request and gets exactly the response it always did (no `garment_mode` field). The same garment file twice is refused.
- **Prompt.** A `single` request sends the same message as before multiple images existed, so its prompt version is unchanged. Each multi-image mode adds a few instruction lines to the user message and labels every garment image by position and role; each has its own recorded prompt version (`tests/core/garmentModes.test.ts`). `memory/SYSTEM_PROMPT.md` is not changed. The added lines are kept short enough that the whole prompt text stays within `maxTextInputTokens`, the bound the spend reservation is computed from.
- **Spend.** The reservation covers every image actually sent (the personal photo plus one to three garment photos). Limits, budgets and concurrency are unchanged.
- **Per-item notes.** In `outfit_items` mode the model may return `outfit_components`: one note per item with a qualitative label (Works well, Works, Needs attention, Unable to tell). It is validated separately (`lib/services/openai/outfitComponentsSchema.ts`), exactly like the shopping advisor: a missing or malformed block leaves the analysis untouched, and nothing in it reaches `computeVerdict`. This is `analysis-output/2`; every `/1` output is still valid.
- **Not validated against a live model.** The multi-image modes were built and tested with mocks and synthetic fixtures only. How well a model follows the new instructions is unknown until an approved live benchmark is run and replayed.

## Evidence summary and the decision report

`lib/services/evidenceSummary.ts` describes how much a verdict rests on: which weighted dimensions were rated, which were left "Unable to Evaluate", and which have Low confidence. It is display only. The report (`components/fashion/DecisionReport.tsx`) uses it to state, next to the verdict, when the verdict rests on few or uncertain ratings, and to show no score when nothing that counts could be evaluated. It never changes a rating, the score or the band.

The report also shows each dimension's weight and the band boundaries on the score scale. Those are display copies of the values inside `computeVerdict`; `tests/core/evidenceSummary.test.ts` derives the real values from `computeVerdict` and fails if a copy disagrees.

## Design system

Tokens live in `app/globals.css` and are exposed through `tailwind.config.js`: one warm dark palette, a single champagne accent, and four muted verdict tones (`verdict-high`, `-good`, `-caution`, `-low`) shared by bands and ratings through `lib/constants/verdictTones.ts`. Text is Inter and headings are Instrument Serif, both self-hosted by `next/font` (no request to a font CDN from the browser).

Motion is CSS first (entrances, verdict reveal, meters, skeletons, progress). Framer Motion remains for step transitions and existing pages; no animation library was added. Reduced motion is handled in one place: a `prefers-reduced-motion` block in `globals.css` switches off every CSS animation and transition, and `MotionConfig reducedMotion="user"` in `app/providers.js` does the same for Framer Motion. No content depends on an animation having run.

## API origin policy and security headers

The frontend calls the API from its own origin, so no cross-origin access is granted by default (`lib/security/originPolicy.ts`).

- **Refusing cross-site requests.** A `POST` whose `Origin` header is neither the request's own host nor listed in `CORS_ORIGINS` gets `403 forbidden_origin` before validation, spend reservation or any model call. This is separate from CORS: a multipart `POST` needs no preflight, so a browser would send it (and the model call would be billed) even when the page could not read the answer. The same-origin test compares the `Origin` host with `X-Forwarded-Host` (set by Vercel) or `Host`, so Production, every Preview deployment and local development work with no configuration.
- **CORS.** `Access-Control-Allow-Origin` is sent only to an origin listed exactly in `CORS_ORIGINS` (comma-separated, for example `https://app.example.com`). Wildcards are ignored. `Access-Control-Allow-Credentials` is never sent: the API uses no cookies. Preflights allow `GET, POST, OPTIONS` and the `Content-Type` header only.
- **Requests without an `Origin` header** (curl, scripts) are not affected by this policy. Rate limits and the spend guard are what protect against them.
- **Methods.** The route exports `GET`, `POST` and `OPTIONS` only; other methods get 405 from the framework.

Every response carries the headers in `lib/security/securityHeaders.js`, applied by `next.config.js`:

| Header | Value |
|---|---|
| `X-Frame-Options` | `DENY` |
| `Content-Security-Policy` | `frame-ancestors 'none'; base-uri 'self'; form-action 'self'; object-src 'none'` |
| `X-Content-Type-Options` | `nosniff` |
| `Referrer-Policy` | `strict-origin-when-cross-origin` |
| `Permissions-Policy` | `camera=(self)`, with microphone, geolocation, payment, USB and motion sensors off |

`Strict-Transport-Security` is sent by Vercel and is not set in code. The policy does not yet restrict script, style, image or connection sources: the app uses a Google Fonts `@import`, Unsplash images and Next.js inline scripts, so that needs nonces and a check on a real Preview deployment first.

The template's unauthenticated MongoDB `/api/status` endpoints have been removed. Nothing in the app used them.

## Shopping Advisor

Shopping Advisor is an optional extension of the existing single multimodal analysis call. It is validated independently after the core dimensions so malformed advisory data cannot affect a calculated verdict. Retail search links are generated by the application from validated recommendation fields and fixed retailer URL templates; no retailer APIs, scraping, affiliate links, or product data are used.

## Logging

Server code logs through `lib/observability/safeLogger.ts`, which emits one JSON object per event with an allowlisted set of fields (request id, endpoint, operation, model, duration, token usage, error category, HTTP status, schema issue count and paths). Unknown fields are dropped, secret-like strings are redacted, and a model name that looks like an API key is replaced with `[redacted]` and flagged as `model_config_suspect`.

Never logged: API keys, uploaded images, prompts, model output text (it can describe a person's appearance), validation messages or received values, request bodies, error messages or stack traces. Each API request gets a server-generated `request_id` so its events can be correlated.

## Request trace

Every API request gets a random `request_id`. It is returned to the client in an `X-Request-Id` response header and written on every log event of that request. It is not stored anywhere and no endpoint looks anything up by it, so it cannot be used to retrieve user data.

The trace of one analysis is the set of events sharing its `request_id`:

| Field | Event | Meaning |
|---|---|---|
| `request_id` | all | Correlates the events of one request |
| `model`, `reasoning_effort` | `openai_request_*` | Allowlisted model id and the effort actually sent |
| `prompt_version` | `openai_request_*` | Fingerprint of the prompt template that was sent |
| `schema_version` | `openai_request_*` | Version of the schema the output is validated against |
| `analysis_mode` | `openai_request_*`, `api_request_completed` | `openai`, `benchmark` or `mock` |
| `outcome` | `openai_request_completed`, `api_request_completed` | Result status, for example `complete` or `unable_to_analyze` |
| `duration_ms` | `openai_request_completed`, `openai_request_failed`, `api_request_completed` | Provider latency, or total latency in mock mode |
| token counts, `cost_micro_usd` | `openai_request_completed`, `openai_request_failed` | Reported usage and the cost computed from it, when the provider reported usage |
| `validation` | `openai_request_*` | `passed`, `failed` (schema mismatch) or `not_run` (the provider failed first) |
| `error_code`, `http_status` | `openai_request_failed` | Failure category |
| reservation and settlement | `spend_reserved`, `spend_settled`, `spend_rejected` | Budget accounting for the same request |

Mock mode never reaches the model client, so it writes one `api_request_completed` event with the mode, outcome, status and latency.

## Prompt and schema versions

- **Prompt version** (`lib/services/openai/promptVersion.ts`): the first 12 hex characters of a SHA-256 over the system prompt file and the user message, as produced by the same builder functions that produce the real request. User values and images are replaced by fixed placeholders first, so the version identifies the template and never depends on a user. Line endings are normalised, so a Windows checkout and the Linux deployment report the same version. Editing `memory/SYSTEM_PROMPT.md`, `memory/STYLE_PROFILE_SYSTEM_PROMPT.md` or any fixed instruction line changes the version automatically. `tests/versioning/promptVersion.test.ts` records the current versions, so a prompt change is visible in review.
- **Schema version**: `ANALYSIS_OUTPUT_SCHEMA_VERSION` (`analysis-output/2`, covering the analysis, shopping recommendation and outfit component schemas; `/2` added the optional `outfit_components` block) and `PROFILE_OUTPUT_SCHEMA_VERSION` (`profile-output/1.0`). `tests/versioning/schemaVersions.test.ts` pairs each version with a fingerprint of the schema's structure and fails if a schema changes without a version bump.

## Client disconnects

A client that disconnects does not cancel the model call. This is deliberate:

- Aborting leaves the cost unknown, and an unknown outcome keeps the full worst-case reservation charged. Letting the call finish settles the reservation to the real cost, which is lower.
- There is no evidence that aborting a non-streaming request stops the provider from billing it.
- The function still ends within the route's `maxDuration`, and the reservation is always settled in a `finally` block. If the function is killed, the lease expires after 90 seconds and stays charged in full. A reservation is never left open indefinitely.

`tests/trace/requestTrace.test.ts` pins this behaviour. The browser stops waiting after 70 seconds (`lib/services/uploadRequest.ts`); that does not affect the server.

## Model configuration

`lib/services/openai/modelConfig.ts` is the single allowlist of models: `gpt-4.1` and `gpt-6.1-terra`. Any other `OPENAI_MODEL` value is rejected before a request is made (`config_issue: unsupported_model`); the value itself is never logged.

| | gpt-4.1 | gpt-6.1-terra |
|---|---|---|
| Reasoning effort | none sent (unsupported) | `low`, set explicitly (provider default is `medium`) |
| Output cap (analysis / profile) | 1,500 / 2,000 | 4,000 / 4,000, which includes reasoning tokens |
| Timeout (analysis / profile) | 20 s / 30 s | 45 s / 45 s |
| Price per 1M tokens (input / cached / output) | $2 / $0.50 / $8 | $1 / $0.05 / $5 |

GPT-4.1 requests are byte-for-byte what they were before. All calls go through `lib/services/openai/responsesClient.ts`, which never retries. A response cut off by the output cap returns error code `incomplete` (still billed); users see the same 502 message as for invalid output. The route's `maxDuration` is 60 seconds.

## Dependency audit

`npm run audit:check` (`scripts/security/audit-check.cjs`) runs `npm audit` for production dependencies and applies the policy in `scripts/security/audit-policy.cjs`. The `Dependency audit` workflow runs it on every pull request, on every push to `main`, and weekly, because an advisory can be published for a dependency that has not changed.

- **Fails on** any high or critical advisory that is not listed in `security/audit-exceptions.json`, on an expired exception, on an invalid exceptions file, on an audit record that cannot be read, and when the audit itself cannot be completed.
- **Reports without failing:** moderate and low advisories, and exceptions that are no longer needed.
- **Exceptions** name individual advisories (never a whole package), state a reason and a plan, and expire after at most 180 days. A new advisory for a package that already has an exception still fails. Each package and advisory pair is judged on its own: when one advisory is reported for two packages, an exception for one never covers the other.
- **Not covered:** development-only dependencies (test and build tooling that is not deployed) are not enforced. Run `npm audit` without `--omit=dev` to see them.

A passing check means no unreviewed high or critical advisory is known for the production dependency tree on that day. It does not mean the dependencies are free of vulnerabilities, and it only knows what has been published.

The workflow is separate from the test workflow and is not a required status check unless it is added to the branch protection rules for `main`.

**PostCSS override.** Next.js 15.5.x declares an exact, unpatched PostCSS (8.4.31) and no 15.5.x release ships a patched one. `package.json` therefore pins `postcss` to an exact patched version in `devDependencies` and uses an npm `overrides` entry (`next > postcss: $postcss`) so that Next.js loads that same single copy. This repository is installed with npm (`package-lock.json`, `npm ci` in CI), so `overrides` is what takes effect; the `resolutions` block is read only by Yarn and is kept on the same PostCSS version so it cannot bring an old copy back. `tests/dependencies/patchedDependencies.test.ts` fails if the override is lost, if a second PostCSS copy returns, or once Next.js declares a patched PostCSS itself, at which point the override should be removed.

**Open items, reviewed 2026-11-17.**
- Production: `zod` GHSA-mrhx-c7xc-m3w5 (high) is the only exception left. It is fixed only in Zod 4 and is accepted with a mitigation until 2027-02-14; the migration is a separate task.
- Development only, not enforced: `glob` GHSA-3g3m-2fjr-6pw4 and `minimatch` GHSA-g3hv-75wg-m249 (moderate), both installed through Jest 30. The newest Jest release still depends on an affected `glob`, so there is no update to take yet. They run only in the test runner, on this repository's own files. `deepmerge` GHSA-gcqx-w48m-w2h4 was withdrawn in the GitHub Advisory Database on 2026-11-16 and is not an open item.

`sharp` is a direct dependency pinned to an exact version, shared with Next.js as a single copy. It is used by the server-side image intake; `tests/dependencies/sharpDependency.test.ts` checks that the pinned binary loads on each CI Node version.

## Spending protection

`lib/spend/spendGuard.ts` runs around every billable call in `app/api/[[...path]]/route.js`:

1. **Reserve** the worst-case cost atomically in Redis (one Lua script). The worst case is the text-input bound plus the per-image bound plus the full output cap. The same script enforces:
   - per-client rate limits: analysis 6 per 10 minutes and 30 per day; profile 3 per 10 minutes and 10 per day;
   - one in-flight call per client, and a global concurrency cap;
   - the daily budget and the cumulative budget.
2. **Call** OpenAI.
3. **Settle**:
   - reported usage: settle to the actual cost;
   - configuration errors and HTTP 4xx: settle to $0;
   - timeouts, network errors, 5xx and anything else unknown: keep the full reservation;
   - a lease that is never settled expires after 90 seconds and stays charged in full.

| Variable | Purpose | Default |
|---|---|---|
| `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN` (or `KV_REST_API_URL`, `KV_REST_API_TOKEN`) | Budget store. The URL must be an https `*.upstash.io` endpoint. | required in production |
| `SPEND_DAILY_LIMIT_USD` | Daily application budget | 1 |
| `SPEND_DAILY_WARN_USD` | Logs `spend_daily_warning_threshold` once per day | 0.75 |
| `SPEND_TOTAL_LIMIT_USD` | Cumulative budget; never resets in code | 25 |
| `SPEND_MAX_CONCURRENT` | Global in-flight billable calls | 2 |

**Fail-closed rules:**
- A missing, invalid or unreachable store, or an invalid `SPEND_*` value, returns 503 with no OpenAI call. This applies to every `NODE_ENV=production` build, including Vercel Preview.
- Local `next dev` fails closed too: Production, Preview and local development share the same OpenAI credits. Unprotected local calls are allowed only with `SPEND_GUARD_ALLOW_UNPROTECTED_DEV=I_ACCEPT_UNPROTECTED_SPEND`, which logs `spend_guard_disabled` once and is ignored in production builds.
- Mock mode never reaches the guard.

**Local development with real calls:** give local development its own Upstash database in `.env.local`, with smaller limits (for example `SPEND_TOTAL_LIMIT_USD=3`, `SPEND_DAILY_LIMIT_USD=0.5`, `SPEND_DAILY_WARN_USD=0.4`). Keys are namespaced by environment, so local and Production counters are separate. Their limits together must stay within the available OpenAI credit.

**Client identity:** client addresses come from Vercel-set headers only when `VERCEL=1`, and are stored as an HMAC, never raw.

**Administration:** there is no endpoint to read or reset budgets; counters are visible and editable only in the Upstash console (`verdict:<environment>:spend:*`).

**Limits of this guard:** it does not see spend made with the same OpenAI key outside this app (local development, benchmarks). Give production its own OpenAI project and key.

## Benchmark

`benchmark/` compares models on the production code path. It defaults to a dry run with networking disabled; billable runs need an explicit opt-in phrase and a spend cap. See `benchmark/README.md`.

## Evaluation

`evaluation/` scores model output without calling a model. See `evaluation/README.md`.

| Mode | Input | Calls a model |
|---|---|---|
| Mock | Hand-written fixture outputs, committed in `evaluation/fixtures/mock/`; runs in `npm test` and CI | Never |
| Replay | A recording written by an earlier live benchmark run | Never |
| Live | `npm run benchmark` with its opt-in phrase and spend cap; writes a recording | Yes |

`npm run eval` has no live mode and disables network access, so it cannot fall back to a billable call. A recording ties each output to the model, prompt version, schema version and a fingerprint of the manifest. Outputs for photos of real people are never stored. Reports are JSON with sorted keys and no timestamps or model text, so they can be compared with a diff.

Metrics are reported in three groups: model output (validity, abstention, stability across runs, confidence), Verdict's own deterministic code, and end-to-end results (verdict band agreement, sensitivity to adversarial text).

### Evaluation Framework 2.0

An extension of the same harness. It adds no production code and changes no prompt, schema, model setting or verdict.

| Piece | Where | What it does |
|---|---|---|
| Reference sets | `evaluation/reference.ts` | What a case is expected to produce, with provenance. Four tiers: image-reviewed, brief-derived, synthetic, unreviewed. Only image-reviewed references, scored against model outputs, are evidence about accuracy on real images |
| Quality metrics | `evaluation/quality.ts` | Per-dimension exact agreement, agreement within one band and mean absolute error; explanation grounding (a labelled proxy); confidence calibration; image modes; outfit garment type accuracy |
| Metric-level regression | `evaluation/regression.ts` | Improvement, no meaningful change, regression, inconclusive or unavailable, with a minimum sample of 10 and a documented noise margin. Baseline protection covers it |
| Run records | `evaluation/runRecord.ts` | Run id, timestamps, versions, counts, cost and outcome in a separate file, so the report stays byte-reproducible |
| Human review | `evaluation/HUMAN_REVIEW.md`, `evaluation/datasets/golden-v1/` | Rubric, review file format, stub generator and validator for adding reviewed cases without touching application code |

Rules that hold:

- Without image-reviewed references, accuracy on real images reads `Unavailable: insufficient human-reviewed ground truth`. It never reads 0.
- Tiers are scored separately and never added together. There is no combined accuracy score.
- Review images are never committed. They live in git-ignored `benchmark/data/`; the committed reference file holds ratings, garment facts and image hashes.
- Colour, pattern and single-garment identification cannot be measured: the model output has no field for them. Garment identification covers the `garment_type` of outfit items only.
- The golden dataset is empty until real images have been reviewed. Until then every figure about model quality is unavailable.
