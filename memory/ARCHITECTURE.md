# Architecture

Frontend → Input Validation → Single Multimodal AI Call → Core JSON Validation → Verdict Calculation (app code) → Independent Shopping Advisor Validation → Decision Report UI

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

Photos are chosen with native file inputs only (`components/fashion/UploadCard.tsx`): one with a `capture` hint (front camera for the personal photo and Style DNA, rear camera for the garment) and a separate gallery/file input. There is no `getUserMedia` and no camera SDK.

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

Uploads go through `lib/services/uploadRequest.ts`: one request per submission, no automatic retry, a 70-second client timeout (above the route's 60-second `maxDuration`), and distinct messages for offline, network failure and HTTP 400, 413, 429 and 503. Server-side validation in `lib/services/analysisService.ts` is unchanged and still applies to every request.

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
- **Schema version**: `ANALYSIS_OUTPUT_SCHEMA_VERSION` (`analysis-output/1`, covering the analysis and shopping recommendation schemas) and `PROFILE_OUTPUT_SCHEMA_VERSION` (`profile-output/1.0`). `tests/versioning/schemaVersions.test.ts` pairs each version with a fingerprint of the schema's structure and fails if a schema changes without a version bump.

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

`sharp` is a direct dependency pinned to an exact version, shared with Next.js as a single copy. The application does not import it yet; `tests/dependencies/sharpDependency.test.ts` checks that the pinned binary loads on each CI Node version.

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

Metrics are reported in three groups: model output (validity, abstention, stability across runs, confidence), Verdict's own deterministic code, and end-to-end results (verdict band agreement, sensitivity to adversarial text). Attribute accuracy is reported as not available, because the model output has no garment, colour or pattern fields.
