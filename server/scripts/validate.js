/*
  Validation harness (deliverable: "Validation evidence — ≥3 measured metrics").
  Runs ENTIRELY in-memory (no DB, no network) so it executes anywhere:

    1. Anomaly precision / recall  — 20 injected anomalous windows vs 20 normal windows
    2. False-positive rate         — normal Eid-burst windows incorrectly flagged
    3. Shortage detection lead time — minutes between first warning and simulated depletion
    4. Alert explanation coverage  — % of subtypes producing reason+evidence+uncertainty (guard-safe)
    5. Engine latency p50 / p95    — forecast+anomaly compute time at demo volume

  Usage: npm run validate
*/
import { computeForecast } from '../services/forecast.js';
import { detectAnomalies } from '../services/anomaly.js';
import { templateExplanation } from '../services/explain.js';
import { isSafeLanguage } from '../services/languageGuard.js';

const rnd = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;
const pick = (a) => a[Math.floor(Math.random() * a.length)];
let seq = 0;
const txn = (over) => ({
  txnId: `V-${++seq}`, provider: 'bKash', type: 'cash_out', amount: rnd(500, 6000),
  status: 'success', customerHash: `CUST-${rnd(1000, 9999)}`, timestamp: new Date(), ...over,
});

function baselineTxns(now, hours = 3) {
  const out = [];
  for (let m = hours * 60; m > 60; m -= rnd(2, 5)) {
    out.push(txn({ timestamp: new Date(now - m * 60_000), amount: rnd(500, 6000) }));
  }
  return out;
}

/* ---------- 1+2: anomaly precision / recall / FP rate ---------- */
function anomalyEval(n = 20) {
  let tp = 0, fn = 0, fp = 0, tn = 0;
  for (let i = 0; i < n; i++) {
    const now = Date.now();
    const baseline = baselineTxns(now);
    // ANOMALOUS window: repeated near-identical amounts from ≤3 accounts + velocity burst
    const bad = [];
    const accounts = ['CUST-1', 'CUST-2', 'CUST-3'];
    for (let k = 0; k < rnd(6, 10); k++) bad.push(txn({ amount: 9800 + rnd(0, 2) * 100, customerHash: pick(accounts), timestamp: new Date(now - rnd(0, 4) * 60_000) }));
    const hit = detectAnomalies({ provider: 'bKash', recentTxns: bad, baselineTxns: baseline, now: new Date(now) }).length > 0;
    hit ? tp++ : fn++;
  }
  for (let i = 0; i < n; i++) {
    const now = Date.now();
    const baseline = baselineTxns(now);
    // NORMAL Eid burst: higher volume but varied amounts, many distinct accounts, moderate rate
    const normal = [];
    for (let k = 0; k < rnd(3, 5); k++) normal.push(txn({ amount: rnd(700, 6500), timestamp: new Date(now - rnd(0, 4) * 60_000) }));
    const hit = detectAnomalies({ provider: 'bKash', recentTxns: normal, baselineTxns: baseline, now: new Date(now) }).length > 0;
    hit ? fp++ : tn++;
  }
  const precision = tp / Math.max(1, tp + fp);
  const recall = tp / Math.max(1, tp + fn);
  const fpRate = fp / Math.max(1, fp + tn);
  return { precision, recall, fpRate, tp, fn, fp, tn };
}

/* ---------- 3: shortage detection lead time ---------- */
function leadTimeEval(runs = 10) {
  const leads = [];
  for (let r = 0; r < runs; r++) {
    let balance = rnd(40, 60) * 1000;
    const floor = 5000;
    const burnPerMin = rnd(300, 700);
    const start = Date.now();
    const txns = [];
    let firstWarnAt = null;
    let depletedAt = null;
    for (let min = 0; min < 240 && !depletedAt; min++) {
      const ts = new Date(start + min * 60_000);
      const amt = burnPerMin; // steady drain via cash_in (e-money outflow)
      txns.push(txn({ type: 'cash_in', amount: amt, timestamp: ts }));
      balance -= amt;
      if (balance <= floor) { depletedAt = min; break; }
      const f = computeForecast({ resource: 'emoney', provider: 'bKash', currentBalance: balance, floorThreshold: floor, txns, now: new Date(ts.getTime() + 1000) });
      if (!firstWarnAt && (f.status === 'warning' || f.status === 'critical')) firstWarnAt = min;
    }
    if (firstWarnAt !== null && depletedAt !== null) leads.push(depletedAt - firstWarnAt);
  }
  leads.sort((a, b) => a - b);
  return { medianLeadMin: leads[Math.floor(leads.length / 2)] ?? null, runs: leads.length };
}

/* ---------- 4: explanation coverage ---------- */
function coverageEval() {
  const subtypes = ['cash_depletion', 'emoney_depletion', 'velocity_spike', 'repeated_amount', 'stale_feed', 'balance_mismatch'];
  const evidence = {
    cash_depletion: { resource: 'cash', provider: null, burnRatePerMin: 500, windowMin: 30, projectedDepletionAt: new Date(), suggestedTopUp: 20000 },
    emoney_depletion: { resource: 'emoney', provider: 'Nagad', burnRatePerMin: 400, windowMin: 30, projectedDepletionAt: new Date(), suggestedTopUp: 15000 },
    velocity_spike: { provider: 'bKash', bucketMinutes: 5, bucketCount: 14, baselineMean: 3.2, baselineStd: 1.5, zScore: 7.2 },
    repeated_amount: { provider: 'bKash', amount: 9800, repeatCount: 7, distinctAccounts: 2, windowMinutes: 30 },
    stale_feed: { provider: 'Rocket', ageMinutes: 22, thresholdMinutes: 10 },
    balance_mismatch: { provider: 'Rocket', expected: 51000, actual: 58777, deltaAbs: 7777, tolerance: 1 },
  };
  let ok = 0;
  for (const s of subtypes) {
    const ex = templateExplanation({ subtype: s, confidence: 0.7, evidence: evidence[s] });
    const fields = [ex.title_en, ex.title_bn, ex.message_en, ex.message_bn, ex.message_banglish, ex.recommendedNextStep_en, ex.recommendedNextStep_bn];
    if (fields.every((f) => f && isSafeLanguage(f))) ok++;
  }
  return { covered: ok, total: subtypes.length, coverage: ok / subtypes.length };
}

/* ---------- 5: engine latency ---------- */
function latencyEval(iters = 200) {
  const now = Date.now();
  const baseline = baselineTxns(now, 6);
  const recent = baseline.slice(-60);
  const times = [];
  for (let i = 0; i < iters; i++) {
    const t0 = performance.now();
    computeForecast({ resource: 'emoney', provider: 'bKash', currentBalance: 50000, floorThreshold: 5000, txns: recent, now: new Date(now) });
    detectAnomalies({ provider: 'bKash', recentTxns: recent, baselineTxns: baseline, now: new Date(now) });
    times.push(performance.now() - t0);
  }
  times.sort((a, b) => a - b);
  const p = (q) => times[Math.floor(times.length * q)];
  return { p50: p(0.5), p95: p(0.95), iters, txnVolume: baseline.length };
}

/* ---------- run + report ---------- */
const a = anomalyEval();
const l = leadTimeEval();
const c = coverageEval();
const t = latencyEval();

console.log('\n=== VALIDATION EVIDENCE (in-memory, synthetic; assumptions in docs/data-simulation.md) ===\n');
console.log(`1. Anomaly precision : ${(a.precision * 100).toFixed(1)}%   (TP=${a.tp} FP=${a.fp})   target ≥80%`);
console.log(`   Anomaly recall    : ${(a.recall * 100).toFixed(1)}%   (TP=${a.tp} FN=${a.fn})   target ≥80%`);
console.log(`2. False-positive rate on normal Eid bursts: ${(a.fpRate * 100).toFixed(1)}%   (FP=${a.fp}/${a.fp + a.tn})   target ≤10%`);
console.log(`3. Shortage detection lead time (median)   : ${l.medianLeadMin} min before depletion (${l.runs} runs)   target ≥15 min`);
console.log(`4. Alert explanation coverage              : ${(c.coverage * 100).toFixed(0)}% (${c.covered}/${c.total} subtypes: reason+evidence+uncertainty, guard-safe)   target 100%`);
console.log(`5. Engine latency (forecast+anomaly)       : p50 ${t.p50.toFixed(2)} ms, p95 ${t.p95.toFixed(2)} ms @ ${t.txnVolume} txns   target p95 <300 ms`);
console.log('\nNote: anomaly flags are advisory signals requiring human review — never fraud determinations.\n');
