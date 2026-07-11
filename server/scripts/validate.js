/*
  Validation harness (deliverable: "Validation evidence — ≥3 measured metrics").
  Runs ENTIRELY in-memory (no DB, no network). For HTTP-level latency against a
  running server + MongoDB, see scripts/latency-http.js.

  METHODOLOGY (addresses circular-validation risk):
    - Labels come from BEHAVIORAL SCENARIOS (what a simulated actor is doing),
      NOT from the detector's own thresholds. Scenario parameters deliberately
      differ from detector internals (jittered non-round amounts, variable
      counts, borderline cases) so the evaluation can actually fail.
    - SEEDED PRNG (--seed N, default 20260711): identical numbers on every run,
      reproducible and tied to a git commit in the written report.
    - The lead-time drain is NON-LINEAR (accelerating demand + noise) — it
      violates the forecaster's linear-window assumption on purpose.
    - demand_surge findings (requiresReview=false) do NOT count as review flags.

  Usage:
    npm run validate                 # print metrics
    npm run validate -- --seed 42    # different seed
    npm run validate -- --report     # also write docs/validation-report.md
*/

import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { computeForecast } from '../services/forecast.js';
import { detectAnomalies } from '../services/anomaly.js';
import { templateExplanation } from '../services/explain.js';
import { isSafeLanguage } from '../services/languageGuard.js';
import { mulberry32 } from './lib/generateSeedData.js';

const args = process.argv.slice(2);
const SEED = Number(args[args.indexOf('--seed') + 1] || 0) || 20260711;
const WRITE_REPORT = args.includes('--report');

const random = mulberry32(SEED);
const rnd = (min, max) => Math.floor(random() * (max - min + 1)) + min;
const pick = (a) => a[Math.floor(random() * a.length)];
let seq = 0;
const txn = (over) => ({
  txnId: `V-${++seq}`, provider: 'bKash', type: 'cash_out', amount: rnd(500, 6000),
  status: 'success', customerHash: `CUST-${rnd(1000, 9999)}`, timestamp: new Date(), ...over,
});

// Fixed evaluation instant — validation must not depend on when it runs.
const NOW = new Date('2026-07-11T15:00:00.000Z').getTime();

function baselineTxns(now, hours = 3) {
  const out = [];
  for (let m = hours * 60; m > 60; m -= rnd(2, 5)) {
    out.push(txn({ timestamp: new Date(now - m * 60_000), amount: rnd(500, 6000) }));
  }
  return out;
}

/* ---------- 1+2: anomaly precision / recall / FP rate on scenario-labeled windows ----------
   Each scenario describes ACTOR BEHAVIOR; the label is the scenario's intent.
   Parameters intentionally do NOT mirror detector thresholds. */
const POSITIVE_SCENARIOS = [
  {
    name: 'structuring_jitter', // near-identical but JITTERED amounts (not round ৳100 steps), 2-3 accounts
    gen: (now) => {
      const accounts = Array.from({ length: rnd(2, 3) }, (_, i) => `CUST-${i + 1}`);
      const base = rnd(9500, 9900);
      return Array.from({ length: rnd(6, 10) }, () =>
        txn({ amount: base + rnd(-80, 80), customerHash: pick(accounts), timestamp: new Date(now - rnd(0, 4) * 60_000) }));
    },
  },
  {
    name: 'single_account_burst', // one account hammering cash-outs at varied amounts
    gen: (now) => Array.from({ length: rnd(8, 14) }, () =>
      txn({ amount: rnd(2000, 8000), customerHash: 'CUST-77', timestamp: new Date(now - rnd(0, 4) * 60_000) })),
  },
  {
    name: 'uniform_amount_burst', // one exact amount, several accounts — machine-like uniformity
    gen: (now) => {
      const amount = pick([4000, 5000, 7500]);
      return Array.from({ length: rnd(7, 12) }, (_, i) =>
        txn({ amount, customerHash: `CUST-${100 + (i % rnd(4, 6))}`, timestamp: new Date(now - rnd(0, 4) * 60_000) }));
    },
  },
];

const NEGATIVE_SCENARIOS = [
  {
    name: 'eid_rush', // heavy but organic: varied amounts, all-distinct accounts
    gen: (now) => Array.from({ length: rnd(8, 15) }, () =>
      txn({ amount: rnd(700, 6500), timestamp: new Date(now - rnd(0, 4) * 60_000) })),
  },
  {
    name: 'salary_day', // loosely clustered around common salary sums, many distinct accounts
    gen: (now) => Array.from({ length: rnd(6, 12) }, () =>
      txn({ amount: pick([3000, 4000, 5000]) + rnd(-400, 400), timestamp: new Date(now - rnd(0, 4) * 60_000) })),
  },
  {
    name: 'quiet_afternoon', // sparse ordinary traffic
    gen: (now) => Array.from({ length: rnd(1, 4) }, () =>
      txn({ amount: rnd(500, 4000), timestamp: new Date(now - rnd(0, 4) * 60_000) })),
  },
];

function isReviewFlag(findings) {
  return findings.some((f) => f.requiresReview !== false); // demand_surge (info/context) is not a review flag
}

function anomalyEval(perScenario = 20) {
  let tp = 0, fn = 0, fp = 0, tn = 0;
  const breakdown = [];
  for (const s of POSITIVE_SCENARIOS) {
    let hits = 0;
    for (let i = 0; i < perScenario; i++) {
      const baseline = baselineTxns(NOW);
      const flagged = isReviewFlag(detectAnomalies({ provider: 'bKash', recentTxns: s.gen(NOW), baselineTxns: baseline, now: new Date(NOW) }));
      flagged ? (tp++, hits++) : fn++;
    }
    breakdown.push({ scenario: s.name, label: 'unusual', flagged: hits, total: perScenario });
  }
  for (const s of NEGATIVE_SCENARIOS) {
    let hits = 0;
    for (let i = 0; i < perScenario; i++) {
      const baseline = baselineTxns(NOW);
      const flagged = isReviewFlag(detectAnomalies({ provider: 'bKash', recentTxns: s.gen(NOW), baselineTxns: baseline, now: new Date(NOW) }));
      flagged ? (fp++, hits++) : tn++;
    }
    breakdown.push({ scenario: s.name, label: 'normal', flagged: hits, total: perScenario });
  }
  const precision = tp / Math.max(1, tp + fp);
  const recall = tp / Math.max(1, tp + fn);
  const fpRate = fp / Math.max(1, fp + tn);
  return { precision, recall, fpRate, tp, fn, fp, tn, breakdown };
}

/* ---------- 3: shortage detection lead time on a NON-LINEAR drain ----------
   Demand accelerates (pre-Eid ramp) with multiplicative noise — the forecaster
   assumes a linear 30-min window, so this measures real-world usefulness, not
   the model grading its own homework. */
function leadTimeEval(runs = 10) {
  const leads = [];
  for (let r = 0; r < runs; r++) {
    let balance = rnd(40, 60) * 1000;
    const floor = 5000;
    const baseBurn = rnd(200, 400);
    const ramp = rnd(5, 15) / 1000; // +0.5%..1.5% demand per minute — accelerating
    const start = NOW;
    const txns = [];
    let firstWarnAt = null;
    let depletedAt = null;
    for (let min = 0; min < 240 && !depletedAt; min++) {
      const ts = new Date(start + min * 60_000);
      const amt = Math.round(baseBurn * (1 + min * ramp) * (0.7 + random() * 0.6)); // noisy, accelerating
      txns.push(txn({ type: 'cash_in', amount: amt, timestamp: ts }));
      balance -= amt;
      if (balance <= floor) { depletedAt = min; break; }
      const f = computeForecast({ resource: 'emoney', provider: 'bKash', currentBalance: balance, floorThreshold: floor, txns, now: new Date(ts.getTime() + 1000) });
      if (!firstWarnAt && (f.status === 'warning' || f.status === 'critical')) firstWarnAt = min;
    }
    if (firstWarnAt !== null && depletedAt !== null) leads.push(depletedAt - firstWarnAt);
  }
  leads.sort((a, b) => a - b);
  return { medianLeadMin: leads[Math.floor(leads.length / 2)] ?? null, minLeadMin: leads[0] ?? null, runs: leads.length };
}

/* ---------- 4: explanation coverage (all 8 subtypes, fully trilingual, guard-safe) ---------- */
function coverageEval() {
  const cases = {
    cash_depletion: { resource: 'cash', provider: null, burnRatePerMin: 500, windowMin: 30, projectedDepletionAt: new Date(NOW), suggestedTopUp: 20000 },
    emoney_depletion: { resource: 'emoney', provider: 'Nagad', burnRatePerMin: 400, windowMin: 30, projectedDepletionAt: new Date(NOW), suggestedTopUp: 15000 },
    velocity_spike: { provider: 'bKash', bucketMinutes: 5, bucketCount: 14, baselineMean: 3.2, baselineStd: 1.5, zScore: 7.2, distinctAccounts: 3 },
    demand_surge: { provider: 'Rocket', bucketMinutes: 5, bucketCount: 18, baselineMean: 3.1, zScore: 6.4, distinctAccounts: 17 },
    repeated_amount: { provider: 'bKash', amount: 9800, repeatCount: 7, distinctAccounts: 2, windowMinutes: 30 },
    stale_feed: { provider: 'Rocket', ageMinutes: 22, thresholdMinutes: 10 },
    missing_feed: { provider: 'Rocket', lastFeedAt: null, thresholdMinutes: 10 },
    balance_mismatch: { provider: 'Rocket', expected: 51000, actual: 58777, deltaAbs: 7777, tolerance: 1 },
  };
  let ok = 0;
  const total = Object.keys(cases).length;
  for (const [s, evidence] of Object.entries(cases)) {
    const ex = templateExplanation({ subtype: s, confidence: 0.7, evidence });
    const fields = [
      ex.title_en, ex.title_bn, ex.title_banglish,
      ex.message_en, ex.message_bn, ex.message_banglish,
      ex.recommendedNextStep_en, ex.recommendedNextStep_bn, ex.recommendedNextStep_banglish,
    ];
    if (fields.every((f) => f && isSafeLanguage(f))) ok++;
  }
  return { covered: ok, total, coverage: ok / total };
}

/* ---------- 5: engine latency (pure compute — HTTP path measured by latency-http.js) ---------- */
function latencyEval(iters = 200) {
  const baseline = baselineTxns(NOW, 6);
  const recent = baseline.slice(-60);
  const times = [];
  for (let i = 0; i < iters; i++) {
    const t0 = performance.now();
    computeForecast({ resource: 'emoney', provider: 'bKash', currentBalance: 50000, floorThreshold: 5000, txns: recent, now: new Date(NOW) });
    detectAnomalies({ provider: 'bKash', recentTxns: recent, baselineTxns: baseline, now: new Date(NOW) });
    times.push(performance.now() - t0);
  }
  times.sort((a, b) => a - b);
  const p = (q) => times[Math.floor(times.length * q)];
  return { p50: p(0.5), p95: p(0.95), iters, txnVolume: baseline.length };
}

/* ---------- run + report ---------- */
let commit = process.env.GITHUB_SHA ? process.env.GITHUB_SHA.substring(0, 7) : 'unknown';
const ranAt = new Date().toISOString();

const a = anomalyEval();
const l = leadTimeEval();
const c = coverageEval();
const t = latencyEval();

const lines = [];
const log = (s = '') => { lines.push(s); console.log(s); };

log('');
log('=== VALIDATION EVIDENCE (in-memory, synthetic; assumptions in docs/data-simulation.md) ===');
log(`    seed ${SEED} · commit ${commit} · ${ranAt}`);
log('');
log(`1. Anomaly precision : ${(a.precision * 100).toFixed(1)}%   (TP=${a.tp} FP=${a.fp})   target ≥80%`);
log(`   Anomaly recall    : ${(a.recall * 100).toFixed(1)}%   (TP=${a.tp} FN=${a.fn})   target ≥80%`);
log(`2. False-positive rate on normal scenarios : ${(a.fpRate * 100).toFixed(1)}%   (FP=${a.fp}/${a.fp + a.tn})   target ≤10%`);
for (const b of a.breakdown) {
  log(`     · ${b.scenario.padEnd(22)} [${b.label}]  flagged ${b.flagged}/${b.total}`);
}
log(`3. Shortage lead time on NON-LINEAR drain  : median ${l.medianLeadMin} min, worst ${l.minLeadMin} min before depletion (${l.runs} runs)   target ≥15 min`);
log(`4. Alert explanation coverage              : ${(c.coverage * 100).toFixed(0)}% (${c.covered}/${c.total} subtypes × 9 trilingual fields, guard-safe)   target 100%`);
log(`5. Engine latency (forecast+anomaly)       : p50 ${t.p50.toFixed(2)} ms, p95 ${t.p95.toFixed(2)} ms @ ${t.txnVolume} txns   target p95 <300 ms`);
log('     (end-to-end HTTP latency: scripts/latency-http.js against a running server)');
log('');
log('Labels come from behavioral scenarios, not detector thresholds; demand_surge (info) is not counted as a review flag.');
log('Note: anomaly flags are advisory signals requiring human review — never fraud determinations.');
log('');

if (WRITE_REPORT) {
  const md = `# Validation Report

- **Date:** ${ranAt}
- **PRNG seed:** ${SEED}
- **Git commit:** ${commit}
- **Command:** \`npm run validate -- --seed ${SEED} --report\`
- **Environment:** in-memory (no DB / network); Node ${process.version}

## Methodology

Labels come from **behavioral scenarios** (what a simulated actor does), not from the
detector's own thresholds — scenario parameters use jittered non-round amounts, variable
counts, and borderline cases so the evaluation can fail. The lead-time drain is
**non-linear** (accelerating demand + noise), deliberately violating the forecaster's
linear-window assumption. \`demand_surge\` findings (info-level context, requiresReview=false)
do **not** count as review flags. The PRNG is seeded → every number below reproduces exactly.

## Results

| # | Metric | Result | Target |
|---|--------|--------|--------|
| 1 | Anomaly precision | ${(a.precision * 100).toFixed(1)}% (TP=${a.tp}, FP=${a.fp}) | ≥80% |
| 1 | Anomaly recall | ${(a.recall * 100).toFixed(1)}% (TP=${a.tp}, FN=${a.fn}) | ≥80% |
| 2 | False-positive rate (normal scenarios) | ${(a.fpRate * 100).toFixed(1)}% (${a.fp}/${a.fp + a.tn}) | ≤10% |
| 3 | Shortage lead time (non-linear drain) | median ${l.medianLeadMin} min, worst ${l.minLeadMin} min (${l.runs} runs) | ≥15 min |
| 4 | Explanation coverage (8 subtypes × 9 trilingual fields) | ${(c.coverage * 100).toFixed(0)}% (${c.covered}/${c.total}) | 100% |
| 5 | Engine latency (forecast + anomaly, in-memory) | p50 ${t.p50.toFixed(2)} ms · p95 ${t.p95.toFixed(2)} ms @ ${t.txnVolume} txns | p95 <300 ms |

### Per-scenario breakdown

| Scenario | Label | Flagged for review |
|----------|-------|--------------------|
${a.breakdown.map((b) => `| ${b.scenario} | ${b.label} | ${b.flagged}/${b.total} |`).join('\n')}

## Limitations

- In-memory evaluation exercises the analytics engines, not the HTTP/DB stack — see
  \`npm run latency\` (scripts/latency-http.js) for end-to-end API timings.
- Synthetic scenarios approximate, but cannot prove, real-world behavior; expected
  false positives and the human-review boundary are documented in docs/responsible-design.md.
- Anomaly flags are advisory signals requiring human review — never fraud determinations.
`;
  const out = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'docs', 'validation-report.md');
  writeFileSync(out, md);
  console.log(`[validate] wrote ${out}`);
}
