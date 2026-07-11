/*
  Anomaly detection — statistical, explainable, evidence-rich.
  Language rule: findings are "unusual / requires review". NEVER fraud. (AC-4)

  Detector 1 — velocity spike, context-aware:
    cash_out count in the current 5-min bucket vs baseline buckets (same provider, history).
    z = (current - mean) / std → candidate when z > 3 AND absolute volume ≥ 6.
    Then CLASSIFY the spike before flagging:
      concentrated (few accounts driving it, or near-uniform amounts) → velocity_spike (requires review)
      diverse (many distinct accounts, varied amounts)               → demand_surge (info; likely
        legitimate demand such as an Eid rush — surfaced as context, NOT flagged for review).
    This is what separates "suspicious pattern" from "busy afternoon".

  Detector 2 — repeated / near-identical amounts, tolerance clustering:
    within the 30-min window, sort cash_out amounts and merge neighbours closer than
    max(৳100, 1.5% of amount) into clusters (catches ৳9,800/9,900/10,000 splitting that
    exact-value grouping misses). Flag a cluster of ≥5 txns from ≤3 distinct accounts,
    provided the cluster is genuinely tight (spread ≤ max(৳200, 2% of mean)).
*/
const BUCKET_MIN = 5;
const WINDOW_MIN = 30;
const VELOCITY_Z_THRESHOLD = 3;
const MIN_BUCKET_COUNT = 6;
const MIN_REPEAT_COUNT = 5;
const MAX_DISTINCT_ACCOUNTS = 3;
// Concentration thresholds for spike classification
const TOP3_SHARE_SUSPICIOUS = 0.6; // ≥60% of the burst from 3 accounts
const AMOUNT_CV_UNIFORM = 0.15;    // near-identical amounts
export const NORMAL_REASONS = [
  'Pre-Eid cash-out demand',
  'Salary-day spike',
  'Provider feed delay or data-quality issue',
];

export function detectVelocitySpike({ provider, recentTxns, baselineTxns, now = new Date() }) {
  const bucketStart = new Date(now.getTime() - BUCKET_MIN * 60_000);
  const current = recentTxns.filter(
    (t) => t.type === 'cash_out' && t.status === 'success' && t.timestamp >= bucketStart
  );

  // Baseline: cash_out counts per 5-min bucket over history
  const counts = new Map();
  for (const t of baselineTxns) {
    if (t.type !== 'cash_out' || t.status !== 'success') continue;
    const b = Math.floor(t.timestamp.getTime() / (BUCKET_MIN * 60_000));
    counts.set(b, (counts.get(b) || 0) + 1);
  }
  const vals = [...counts.values()];
  if (vals.length < 6) return null; // not enough history to judge — safe fallback: no flag

  const mean = vals.reduce((s, v) => s + v, 0) / vals.length;
  const sd = Math.max(1, Math.sqrt(vals.reduce((s, v) => s + (v - mean) ** 2, 0) / vals.length));
  const z = (current.length - mean) / sd;

  // Minimum-support rule: tiny windows inflate z on quiet baselines (small-sample FP source,
  // measured at 15% in validate.js before this guard). Require both statistical AND absolute volume.
  if (z <= VELOCITY_Z_THRESHOLD || current.length < MIN_BUCKET_COUNT) return null;

  // Classify: is the burst CONCENTRATED (few accounts / uniform amounts) or DIVERSE?
  const byAccount = new Map();
  for (const t of current) byAccount.set(t.customerHash, (byAccount.get(t.customerHash) || 0) + 1);
  const topCounts = [...byAccount.values()].sort((a, b) => b - a).slice(0, 3);
  const top3Share = topCounts.reduce((s, c) => s + c, 0) / current.length;
  const amtMean = current.reduce((s, t) => s + t.amount, 0) / current.length;
  const amtSd = Math.sqrt(current.reduce((s, t) => s + (t.amount - amtMean) ** 2, 0) / current.length);
  const amountCV = amtMean > 0 ? amtSd / amtMean : 0;
  const concentrated = top3Share >= TOP3_SHARE_SUSPICIOUS || amountCV < AMOUNT_CV_UNIFORM;

  const evidence = {
    provider,
    bucketMinutes: BUCKET_MIN,
    bucketCount: current.length,
    baselineMean: Math.round(mean * 100) / 100,
    baselineStd: Math.round(sd * 100) / 100,
    zScore: Math.round(z * 100) / 100,
    thresholdZScore: VELOCITY_Z_THRESHOLD,
    minimumBucketCount: MIN_BUCKET_COUNT,
    distinctAccounts: byAccount.size,
    top3AccountShare: Math.round(top3Share * 100) / 100,
    amountVariation: Math.round(amountCV * 100) / 100,
    classification: concentrated ? 'concentrated' : 'diverse_demand',
    involvedTxnIds: current.map((t) => t.txnId),
  };

  if (!concentrated) {
    // High volume but organically distributed — legitimate-demand context, not a review flag.
    return {
      subtype: 'demand_surge',
      provider,
      severity: 'info',
      confidence: Math.min(0.9, 0.5 + z / 20),
      requiresReview: false,
      evidence,
    };
  }

  return {
    subtype: 'velocity_spike',
    provider,
    severity: z > 5 ? 'critical' : 'warning',
    confidence: Math.min(0.9, 0.5 + z / 20),
    evidence,
  };
}

/* Merge sorted amounts whose neighbours are within tolerance into clusters. */
export function clusterAmounts(txns, toleranceFn = (a) => Math.max(100, a * 0.015)) {
  const sorted = [...txns].sort((x, y) => x.amount - y.amount);
  const clusters = [];
  let cur = null;
  for (const t of sorted) {
    if (cur && t.amount - cur.txns.at(-1).amount <= toleranceFn(t.amount)) {
      cur.txns.push(t);
    } else {
      cur = { txns: [t] };
      clusters.push(cur);
    }
  }
  return clusters;
}

export function detectRepeatedAmounts({ provider, recentTxns, now = new Date() }) {
  const windowStart = new Date(now.getTime() - WINDOW_MIN * 60_000);
  const windowTxns = recentTxns.filter(
    (t) => t.type === 'cash_out' && t.status === 'success' && t.timestamp >= windowStart
  );

  for (const cluster of clusterAmounts(windowTxns)) {
    const txns = cluster.txns;
    if (txns.length < MIN_REPEAT_COUNT) continue;
    const amounts = txns.map((t) => t.amount);
    const lo = amounts[0];
    const hi = amounts.at(-1);
    const mean = amounts.reduce((s, a) => s + a, 0) / amounts.length;
    // A chain-merged wide cluster is not "near-identical" — require a tight spread.
    if (hi - lo > Math.max(200, mean * 0.02)) continue;
    const distinctAccounts = new Set(txns.map((t) => t.customerHash)).size;
    if (distinctAccounts <= MAX_DISTINCT_ACCOUNTS) {
      return {
        subtype: 'repeated_amount',
        provider,
        severity: 'warning',
        confidence: 0.7,
        evidence: {
          provider,
          amount: Math.round(mean),
          amountMin: lo,
          amountMax: hi,
          repeatCount: txns.length,
          distinctAccounts,
          windowMinutes: WINDOW_MIN,
          minimumRepeatCount: MIN_REPEAT_COUNT,
          maximumDistinctAccounts: MAX_DISTINCT_ACCOUNTS,
          involvedTxnIds: txns.map((t) => t.txnId),
        },
      };
    }
  }
  return null;
}

export function detectAnomalies({ provider, recentTxns, baselineTxns, now = new Date() }) {
  const findings = [];
  const v = detectVelocitySpike({ provider, recentTxns, baselineTxns, now });
  if (v) findings.push(v);
  const r = detectRepeatedAmounts({ provider, recentTxns, now });
  if (r) findings.push(r);
  return findings.map((f) => ({
    possibleNormalReasons: NORMAL_REASONS,
    requiresReview: true,
    ...f, // demand_surge carries its own requiresReview: false
  }));
}
