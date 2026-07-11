# Architecture

Frontend → Input Validation → Single Multimodal AI Call → JSON Schema Validation → Verdict Calculation (app code) → Decision Report UI

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
| Invalid JSON | Friendly generic error with retry, log raw response |
| Low confidence across dimensions | Show a limited report with a visible low confidence note |
| Image exceeds size/resolution limits | Reject at upload with a specific message |

No failure state should ever produce a broken UI or an unexplained spinner.

## Data Handling
Photos are sent to the model provider for analysis and not persisted beyond the request unless the user opts into history (future phase). Privacy language must be re-verified against the actual provider and retention policy before each release.
