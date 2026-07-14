# Privacy and Security Specification — Phase 3

## Document Status
Specification — not yet implemented.

---

## Core Privacy Stance

> Never state a privacy guarantee the backend cannot enforce. Re-verify privacy language against the actual backend before every release. — `memory/MEMORY.md`

This document describes what is actually enforced, not what sounds good. Every statement here must be verifiable against the implementation before it is shown to users.

---

## Image Handling

### Profile Generation Photo

**Transit:**
- The user's photo is transmitted from the browser to the Next.js API route over HTTPS (enforced by the hosting environment)
- The photo is transmitted from the API route to OpenAI over HTTPS (OpenAI API uses TLS)
- The photo is never written to disk, logged, or stored in any application-layer persistence during this flow

**At rest:**
- The application does not store the photo
- The photo exists only in memory for the duration of the API request
- After the request completes (success or failure), the photo binary is no longer held in application memory

**Shared with OpenAI:**
- The photo is sent to OpenAI as part of the API call
- OpenAI's data handling is governed by OpenAI's API data usage policies
- The privacy note shown to users must reflect OpenAI's actual retention policy, which must be verified before any public-facing text is finalized
- Do not assert "OpenAI does not store your photo" without first confirming OpenAI's current API data retention policy

**Current known OpenAI policy stance** (as of knowledge cutoff): OpenAI states that API inputs are not used to train models by default. However, this must be re-verified at implementation time.

### Analysis Photos (Existing — Unchanged)

The same handling applies to the outfit analysis photos (personal photo and garment photo). This behavior is unchanged from Phase 2.

---

## Data Retention

### What Is Retained by the Application

| Data | Stored where | Duration | User control |
|---|---|---|---|
| `AIStyleProfile` (structured JSON) | `localStorage` | Until user deletes it or clears browser data | Delete button on Profile page |
| `StyleProfile` (manual preferences) | `localStorage` | Until user clears it or clears browser data | Unchanged from Phase 1 |
| Profile prompt dismissal flag | `localStorage` | Until user clears browser data | No UI control (minor UX preference) |
| User photos | Not retained | Request lifetime only | N/A |
| Analysis results | Not retained | Not stored in Phase 3 (Phase 4 feature) | N/A |

### What Is Never Retained

- User photos of any kind
- Raw AI responses (before or after validation)
- Outfit analysis images
- Any personally identifiable information beyond what the user explicitly types into the manual style preferences (which are free-form tags like "Casual", not names or contact info)

---

## User Consent

### For Profile Generation

Before sending the photo to the AI, the user sees a confirmation step that includes:

> "Your photo is sent to our AI for analysis and is not stored on our servers."

This statement is accurate if and only if:
1. The application does not persist the photo (verified by implementation)
2. OpenAI's API data handling matches the implied retention policy (must be re-verified)

The privacy note must not say "never stored anywhere" — it must say "not stored on our servers" because OpenAI processes the image on their infrastructure.

**Implementation gate:** This privacy note must be reviewed against OpenAI's current API terms of service before the feature ships. If OpenAI's policy changes, this note must be updated.

### For Analysis (Existing)

The existing analysis flow has no explicit consent step. Phase 3 does not add one to the existing analysis. Consistency: the Profile page is the right place for a privacy disclosure since that is where the user learns about the AI profile concept.

### Consent Is Not a Blocker

The user can dismiss the profile generation feature entirely. The consent note is informational, not a checkbox. This is consistent with the existing design philosophy of the product. A more formal consent mechanism (opt-in, terms acceptance) is a Phase 4+ concern when authentication is introduced.

---

## Regeneration Privacy

When the user regenerates their profile:
- The new photo is handled identically to the initial generation photo
- The old stored profile is replaced by the new one
- The old photo is never retained (it was never stored in the first place)
- No history of profile generations is kept in Phase 3

---

## Deletion Privacy

When the user deletes their AI Style Profile:
- `localStorage.removeItem('verdict_ai_style_profile')` is called
- The structured profile data is removed from the device
- There is nothing server-side to delete (the photo was never stored; the structured profile was only in localStorage)
- Deletion is permanent on this device. Cross-device deletion is not applicable in Phase 3 (no cloud storage)

**Limitation to disclose:** localStorage data can be recovered through browser developer tools or device recovery tools if the device is compromised. This is a browser-native storage limitation, not an application one. In Phase 4, cloud storage with proper deletion will be the appropriate mechanism.

---

## What the Structured Profile Contains

The `AIStyleProfile` stored in `localStorage` contains:

- Abstract descriptors of observable styling characteristics (e.g., "warm undertone", "medium frame width")
- Style keyword labels (e.g., "Minimalist", "Classic")
- Confidence levels

**It does not contain:**
- The user's name, email, or any direct identifier
- The original photo or any image data
- Health information
- Beauty or attractiveness scores (these are explicitly excluded from the schema)
- Location data
- Device identifiers

The stored data is pseudonymous — it describes a person's observable styling characteristics but does not, by itself, identify who that person is.

---

## Security Assumptions

### Client-Side Security

- `localStorage` is accessible to any JavaScript running on the same origin
- The application does not add any additional encryption to localStorage values
- XSS vulnerabilities on the Verdict domain would expose localStorage contents; this is a standard browser security concern, not a Phase 3-specific one
- Phase 4 (authentication) will introduce proper session management that reduces this risk surface

### Server-Side Security

- The API route (`POST /api/generate-profile`) runs in the Next.js server runtime
- The OpenAI API key is stored in environment variables (`OPENAI_API_KEY`) and is never sent to the client
- CORS handling follows the existing pattern (`CORS_ORIGINS` environment variable)
- Multipart form data is processed server-side; no client-provided data is ever executed

### What Is Never Exposed to the Client

- The OpenAI API key
- Raw AI responses before validation
- Internal error details (stack traces, raw error messages from OpenAI are mapped to user-friendly messages)
- Any other server-side secrets

---

## Privacy Language — Approved and Prohibited Phrases

### Approved in UI

| Context | Approved Text |
|---|---|
| Profile generation confirmation | "Your photo is sent to our AI for analysis and is not stored on our servers." |
| Profile page (general) | "Your style data is stored only on this device." |
| After deletion | (Visual empty state — no specific privacy confirmation needed) |

### Prohibited in UI

| Prohibited Phrase | Reason |
|---|---|
| "We never share your data" | Too broad; OpenAI processes the photo |
| "Your photo is completely private" | Misleading about OpenAI's processing |
| "Your data is encrypted" | localStorage is not encrypted by the application |
| "GDPR compliant" | Cannot assert compliance without legal review |
| "We take your privacy seriously" | Meaningless; replaced with specific, verifiable statements |

---

## Privacy Review Gate

Before Phase 3 ships, the following must be verified:

1. **OpenAI API data retention policy** — Confirm the current policy on image inputs sent via the API. Update the UI privacy note accordingly.
2. **No server-side photo logging** — Confirm that the production logging configuration does not log request bodies (which would include image data in multipart requests).
3. **localStorage contents review** — Confirm that the stored `AIStyleProfile` contains no data beyond what this specification describes.
4. **Privacy note text accuracy** — Have a non-engineer read the privacy note shown during profile generation and verify it accurately describes the actual behavior.

---

## Phase 4 Privacy Considerations (Forward-Looking, Not Implemented)

When authentication and cloud storage are introduced:

- Users must be able to request deletion of their cloud-stored profile
- Profile data must be associated with a user account, not a device
- Cross-device sync requires explicit user consent
- Data export (profile data in a machine-readable format) should be considered
- GDPR/CCPA deletion rights become relevant when user accounts are introduced

None of these are Phase 3 deliverables. They are noted here to ensure the Phase 4 architecture team is aware of the privacy obligations that come with user accounts.
