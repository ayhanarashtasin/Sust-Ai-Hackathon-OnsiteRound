# Responsible Design Note

## What this prototype intentionally does NOT do

- **No fraud determinations.** Anomaly flags mean "unusual — requires review",
  never guilt. A runtime language guard (`services/languageGuard.js`) scans every
  alert message (including LLM output) for accusatory vocabulary in English and
  Bangla and rejects it; unit tests enforce this on all templates (AC-4).
- **No financial actions.** No transfer, refill, freeze, block, or reversal exists
  in the codebase. Escalation creates a workflow object (an authorized support
  request), nothing more.
- **No provider boundary violations.** Balances are separate documents per provider;
  no code path converts or nets them. The combined total is display-only and labeled.
- **No customer credentials.** There is no field anywhere for customer PIN, OTP, or
  password. The console login is *staff* authentication (seeded demo accounts) —
  the brief's out-of-scope "collection of credentials" targets customer
  authentication data, and the login screen states this distinction explicitly.
- **No real data.** Every document carries `simulated: true`; the UI shows a
  persistent SIMULATED DATA badge.

## Human review is structural, not decorative

Every anomaly alert carries `requiresReview: true`, a list of possible *normal*
explanations (pre-Eid demand, salary day, data delay), and evidence (the actual
transaction IDs and statistics) so a reviewer can check rather than trust. The case
workflow (acknowledge → escalate to risk → resolve, with notes) is the mechanism by
which a human — not the system — closes the question.

## Uncertainty is always visible

Every forecast and alert carries a confidence value shown in the UI. Confidence is
*reduced* by: small sample size, volatile burn rates, and stale feeds. Stale or
conflicting provider data additionally suppresses recommendations from that feed
(Scenario C) — bad data lowers claims instead of silently producing confident ones.

## False positives

We measure FP rate against simulated normal Eid bursts (`npm run validate`, currently
0% with the minimum-support rule) and document expected real-world FP sources in
`docs/data-simulation.md`. The design position: a reviewable false positive is
acceptable; an unreviewable confident accusation is not.

## Privacy

Synthetic identifiers only (`CUST-####` hashes). No PII is generated, stored, or
displayed. Staff demo passwords are bcrypt-hashed even though the data is synthetic —
the prototype should model correct behavior.
