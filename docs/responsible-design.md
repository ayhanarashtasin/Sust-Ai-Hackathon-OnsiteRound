# Responsible Design Note

## What this prototype intentionally does NOT do

- **No fraud determinations.** Anomaly flags mean "unusual — requires review",
  never guilt. A runtime language guard (`services/languageGuard.js`) scans every
  alert message (including LLM output) for accusatory vocabulary in English and
  Bangla and rejects it; unit tests enforce this on all templates (AC-4).
- **No financial actions.** No transfer, refill, freeze, block, or reversal exists
  in the codebase. Escalation creates a workflow object (an authorized support
  request), nothing more.
- **No provider boundary violations.** Provider balances are separate
  sub-records under one outlet document — *logically* separate: no code path
  converts or nets them, each has its own feed state and forecast, and the
  combined total is display-only and labeled. Server-side scoping enforces the
  boundary on every endpoint: an agent or field officer requesting another
  outlet's data by direct URL gets a 404, and management is read-only on every
  mutation route.
- **No customer credentials.** There is no field anywhere for customer PIN, OTP, or
  password. The console login is *staff* authentication (seeded demo accounts) —
  the brief's out-of-scope "collection of credentials" targets customer
  authentication data, and the login screen states this distinction explicitly.
- **No real data.** Every document — users included — carries `simulated: true`;
  the UI shows a persistent SIMULATED DATA badge.
- **No silent destruction of the record.** "Dismiss" archives an alert
  (status `dismissed`, full history retained). Nothing in the coordination
  workflow deletes alerts, transactions, or balances; the only bulk delete is the
  clearly-labeled demo-reset utility, which a production system would not ship.

## Human review is structural, not decorative

Every anomaly alert carries `requiresReview: true`, a list of possible *normal*
explanations (pre-Eid demand, salary day, data delay), and evidence (the actual
transaction IDs and statistics) so a reviewer can check rather than trust. The case
workflow (acknowledge → assign → escalate to risk → resolve, with notes) is the
mechanism by which a human — not the system — closes the question. A state machine
rejects illegal shortcuts (a resolved case cannot be re-acknowledged; a dismissed
case cannot be resolved), assignees must be real case-working users, and every
transition records **who** (name + role) did **what**, **when**. Evidence updates
snapshot the prior evidence (`evidenceHistory`) instead of overwriting it, and a
condition that a human just resolved is not re-raised for 10 minutes.

## Uncertainty is always visible — and it gates recommendations

Every forecast and alert carries a confidence value shown in the UI. Confidence is
*reduced* by: small sample size, volatile burn rates, stale feeds, missing feeds,
and unreconciled balances. Beyond dimming confidence, **any data-quality issue
withholds the top-up recommendation entirely** (`recommendationSuppressed`) for the
affected provider *and* for shared cash (whose flow mixes all feeds) — bad data
lowers claims instead of silently producing confident ones. A provider with **no**
feed timestamp is treated as the *least* trusted state, not silently skipped.

## Context-aware spike classification (fairness)

A volume spike alone is not treated as suspicious. The velocity detector
classifies each spike: **concentrated** (few accounts driving it, or machine-like
uniform amounts) becomes a review flag; **diverse** (many distinct accounts, varied
amounts — the shape of an ordinary Eid rush) becomes `demand_surge`, an info-level
context signal with `requiresReview: false`. Busy days are explained, not accused.

## False positives

Validation labels come from *behavioral scenarios*, not the detector's own rules
(`npm run validate`, seeded and reproducible — see `docs/validation-report.md`).
Current measured results: **precision 93.8%, recall 100%, FP rate 6.7%**. The
dominant false-positive source is real and documented: salary-day windows where
many customers happen to withdraw unusually uniform amounts occasionally cross the
concentration threshold (~4/20 windows). The design position: a reviewable false
positive is acceptable; an unreviewable confident accusation is not — and the
review workflow is the containment.

## Privacy & security posture

Synthetic identifiers only (`CUST-####` hashes). No PII is generated, stored, or
displayed. Staff demo passwords are bcrypt-hashed; login is rate-limited; the JWT
secret must be provided via environment (the server refuses to boot on a known
default); CORS is restricted to the dev client origin; internal exception details
are logged server-side (with request ids) and never returned to clients.

Known demo-scope trade-offs, documented rather than claimed away: JWT is stored in
localStorage (XSS exposure acceptable for a synthetic-data demo, not production);
simulation state is a single global (one demo at a time); no request-schema
validation library; multi-document write atomicity requires a replica set and is
out of scope (failures surface as reconciliation alerts instead — fail-loud).
