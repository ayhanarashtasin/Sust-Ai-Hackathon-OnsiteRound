# Validation Report

- **Date:** 2026-07-11T13:36:45.226Z (numbers re-verified post-commit — identical, seeded)
- **PRNG seed:** 20260711
- **Git commit:** 3d95282
- **Command:** `npm run validate -- --seed 20260711 --report`
- **Environment:** in-memory (no DB / network); Node v24.14.0

## Methodology

Labels come from **behavioral scenarios** (what a simulated actor does), not from the
detector's own thresholds — scenario parameters use jittered non-round amounts, variable
counts, and borderline cases so the evaluation can fail. The lead-time drain is
**non-linear** (accelerating demand + noise), deliberately violating the forecaster's
linear-window assumption. `demand_surge` findings (info-level context, requiresReview=false)
do **not** count as review flags. The PRNG is seeded → every number below reproduces exactly.

## Results

| # | Metric | Result | Target |
|---|--------|--------|--------|
| 1 | Anomaly precision | 93.8% (TP=60, FP=4) | ≥80% |
| 1 | Anomaly recall | 100.0% (TP=60, FN=0) | ≥80% |
| 2 | False-positive rate (normal scenarios) | 6.7% (4/60) | ≤10% |
| 3 | Shortage lead time (non-linear drain) | median 79 min, worst 52 min (10 runs) | ≥15 min |
| 4 | Explanation coverage (8 subtypes × 9 trilingual fields) | 100% (8/8) | 100% |
| 5 | Engine latency (forecast + anomaly, in-memory) | p50 0.02 ms · p95 0.04 ms @ 90 txns | p95 <300 ms |

### Per-scenario breakdown

| Scenario | Label | Flagged for review |
|----------|-------|--------------------|
| structuring_jitter | unusual | 20/20 |
| single_account_burst | unusual | 20/20 |
| uniform_amount_burst | unusual | 20/20 |
| eid_rush | normal | 0/20 |
| salary_day | normal | 4/20 |
| quiet_afternoon | normal | 0/20 |

## End-to-end HTTP latency (measured separately)

`npm run latency` against the running stack (Express + JWT verify + MongoDB +
analytics + JSON), local MongoDB 8.2, seeded data, 150 sequential requests per
endpoint + a concurrent burst — measured 2026-07-11 on the same commit:

| Endpoint | p50 | p95 | p99 | mean |
|---|---|---|---|---|
| GET /api/agents | 1.7 ms | 4.8 ms | 5.5 ms | 2.2 ms |
| GET /api/agents/AGT-001/forecast | 2.8 ms | 3.6 ms | 5.7 ms | 2.9 ms |
| GET /api/alerts (open) | 1.6 ms | 2.6 ms | 4.2 ms | 1.8 ms |
| Forecast, 10 parallel × 15 rounds | 13.5 ms | 19.1 ms | 23.3 ms | 13.6 ms |

(A remote MongoDB Atlas cluster adds network RTT per query on top of these.)

## End-to-end behavior verification

A scripted API-level check (33 assertions) verified on the same commit: role/area
scoping by direct URL (404s), management read-only (403s), Scenario C fast
staleness + recommendation suppression, the full Scenario D case lifecycle with
state-machine rejections (409/400), dismiss-as-archive (transaction count
unchanged), and the Scenario B contrast (bKash flags for review; Rocket surfaces
only as info-level `demand_surge`).

## Limitations

- In-memory evaluation exercises the analytics engines, not the HTTP/DB stack — see
  `npm run latency` (scripts/latency-http.js) for end-to-end API timings.
- Synthetic scenarios approximate, but cannot prove, real-world behavior; expected
  false positives and the human-review boundary are documented in docs/responsible-design.md.
- Anomaly flags are advisory signals requiring human review — never fraud determinations.
