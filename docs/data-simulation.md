# Data & Simulation Note

## How the synthetic data is created

**Seed (`server/scripts/seed.js`)** — 3 agent outlets in Sylhet, 5 staff users (one
per role), and ~4 hours of baseline transaction history for AGT-001 (1 txn per 2–6
min, cash-out-leaning to reflect pre-Eid demand, 3% failure rate). Balances are
generated *consistently*: `current = opening + Σ signedDelta(txns)`, so the
reconciliation detector never fires on clean data — only on Scenario C's injected
corruption.

**Live streamer (`server/services/simEngine.js`)** — a 2s tick generates scenario
transactions, applies them through a single atomic writer, and recomputes analytics
(compute-on-write). Scenarios:

| Scenario | Injected pattern | Expected detection |
|---|---|---|
| A | steady Nagad cash-ins drain Nagad e-money while totals look healthy | `emoney_depletion` forecast alert with ETA + top-up |
| B | repeated ৳9,800±200 cash-outs from 3 fixed accounts on bKash **plus** a normal Rocket burst (varied amounts, many accounts) | `repeated_amount` / `velocity_spike` flags on bKash; Rocket stays green (FP contrast) |
| C | Rocket `lastFeedAt` frozen + one-time ৳7,777 off-book balance nudge | `stale_feed` + `balance_mismatch`, confidence dimmed |
| D | Scenario B at 2× intensity | critical severity → the coordination walkthrough |

## Identifiers

`customerHash` values are random synthetic labels (`CUST-####`). No real customer
identities, accounts, phone numbers, or credentials exist anywhere in the system.

## Assumptions

- Agent float model: cash-out increases agent e-money and decreases drawer cash;
  cash-in / send-money / payment do the reverse; B2B top-up adds e-money only.
- 30-min forecast window and 5-min anomaly buckets are demo-scale choices; production
  would calibrate per agent/area seasonality.
- Baseline "normal" volume is stationary within the demo session; real Eid seasonality
  would need a seasonal baseline (see limitations).

## Limitations & expected false positives

- The velocity detector assumes ≥6 baseline buckets; with less history it stays
  silent (safe fallback) — so brand-new agents get no velocity coverage.
- A genuinely normal customer paying the same round amount repeatedly (e.g., a
  merchant settling ৳10,000 five times) WOULD flag — that is by design; the flag
  says "requires review", and the review resolves it. Measured FP rate on simulated
  normal Eid bursts: 0% (see `npm run validate`), but real-world FP rate would be
  higher; the human-review workflow is the containment.
- Forecast assumes locally-linear burn; sudden demand shifts change the ETA between
  ticks (confidence reflects rate variance).
