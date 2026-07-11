# Data & Simulation Note

## How the synthetic data is created

**Shared generator (`server/scripts/lib/generateSeedData.js`)** — one pure,
**seeded** generator (mulberry32 PRNG, seed `20260711` by default) produces the
entire synthetic ecosystem: 3 agent outlets in Sylhet, 5 staff users (one per
role), and ~4 hours of baseline transaction history for AGT-001 (1 txn per 2–6
min, cash-out-leaning to reflect pre-Eid demand, ~3% failure rate). The same seed
always reproduces the same outlets, history, and balances.

Two consumers of the same generator:
- `npm run seed` — writes MongoDB for the live demo.
- `npm run sample-data` — writes the **portable committed dataset**
  (`data/sample/`: agents.json, users.json, transactions.csv, manifest.json), so
  what judges download is exactly what the live demo runs on.

Balances are generated *consistently*: `current = opening + Σ signedDelta(txns)`.
A generated transaction the outlet could not cover is recorded as
`failed (insufficient_funds)` and moves nothing — running balances never go
negative, and the reconciliation detector never fires on clean data — only on
Scenario C's injected corruption.

**Live streamer (`server/services/simEngine.js`)** — a 2s tick (overlap-guarded)
generates scenario transactions, applies them through the single writer code path
(same insufficient-funds rule), and recomputes analytics (compute-on-write).

| Scenario | Injected pattern | Expected detection |
|---|---|---|
| A | steady Nagad cash-ins drain Nagad e-money while totals look healthy | `emoney_depletion` forecast alert with ETA + top-up |
| B | repeated ৳9,800–10,000 cash-outs from 3 fixed accounts on bKash **plus** a bigger organic Rocket burst (varied amounts, many accounts) | `repeated_amount` + `velocity_spike` flags on bKash; Rocket classifies as `demand_surge` (info-level context, `requiresReview: false`) — the false-positive contrast |
| C | Rocket `lastFeedAt` backdated past the staleness threshold **on the first tick** (so the fallback demos in seconds) + one-time ৳7,777 off-book balance nudge at tick 5 | `stale_feed` immediately, `balance_mismatch` by tick 5; confidence dimmed AND top-up recommendations withheld for Rocket and shared cash |
| D | Scenario B at 2× intensity | critical severity → the coordination walkthrough (ack → assign → escalate → resolve) |

## Identifiers

`customerHash` values are random synthetic labels (`CUST-####`). No real customer
identities, accounts, phone numbers, or credentials exist anywhere in the system.

## Validation methodology (why it isn't circular)

`npm run validate` (seeded, reproducible — report in `docs/validation-report.md`)
labels windows by **behavioral scenario**, not by the detector's own thresholds:

- *Unusual* scenarios: jittered structuring-style amounts (non-round, ±৳80),
  single-account bursts, machine-uniform amounts across several accounts.
- *Normal* scenarios: organic Eid rush (varied amounts, all-distinct accounts),
  salary-day clusters (common sums ± ৳400, many accounts), quiet afternoons.

The shortage lead-time test uses a **non-linear** drain (accelerating demand +
multiplicative noise) that deliberately violates the forecaster's linear-window
assumption. End-to-end API latency is measured separately against the running
stack (`npm run latency`).

## Assumptions

- Agent float model: cash-out increases agent e-money and decreases drawer cash;
  cash-in / send-money / payment do the reverse; B2B top-up adds e-money only.
  Only `success` transactions settle — pending moves nothing.
- 30-min forecast window and 5-min anomaly buckets are demo-scale choices; production
  would calibrate per agent/area seasonality.
- Baseline "normal" volume is stationary within the demo session; real Eid seasonality
  would need a seasonal baseline (see limitations).
- Sim ticks compress time: one tick ≈ one demo beat, so live bucket counts vastly
  exceed the seeded baseline — this is why spike *classification* (concentration),
  not spike *detection* alone, carries the review decision.

## Limitations & expected false positives

- The velocity detector requires ≥6 baseline buckets; with less history it stays
  silent (safe fallback) — so brand-new agents get no velocity coverage.
- A genuinely normal customer paying the same round amount repeatedly (e.g., a
  merchant settling ৳10,000 five times) WOULD flag — by design; the flag says
  "requires review", and the review resolves it.
- Measured on scenario-labeled synthetic windows (seed 20260711): precision 93.8%,
  recall 100%, **FP rate 6.7%** — the dominant FP source is salary-day windows
  whose amounts happen to be unusually uniform (~4/20 windows cross the
  concentration threshold). Real-world FP rates would be higher; the human-review
  workflow is the containment.
- Forecast assumes locally-linear burn; on the deliberately non-linear validation
  drain it still warns a median 79 min (worst 52 min) before depletion, but sudden
  demand shifts change the ETA between ticks (confidence reflects rate variance).
