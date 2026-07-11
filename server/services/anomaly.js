/*
  Anomaly detection — statistical, explainable, evidence-rich.
  Language rule: findings are "unusual / requires review". NEVER fraud. (AC-4)

  Detector 1 — velocity spike:
    cash_out count in the current 5-min bucket vs baseline buckets (same provider, history).
    z = (current - mean) / std   → flag z > 3

  Detector 2 — repeated / near-identical amounts:
    within the 30-min window, group cash_out by amount rounded to ৳100.
    flag when one amount appears ≥5 times from ≤3 distinct customerHash.
*/
const BUCKET_MIN = 5;
const WINDOW_MIN = 30;
const VELOCITY_Z_THRESHOLD = 3;
const MIN_BUCKET_COUNT = 6;
const MIN_REPEAT_COUNT = 5;
const MAX_DISTINCT_ACCOUNTS = 3;
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
  return {
    subtype: 'velocity_spike',
    provider,
    severity: z > 5 ? 'critical' : 'warning',
    confidence: Math.min(0.9, 0.5 + z / 20),
    evidence: {
      provider,
      bucketMinutes: BUCKET_MIN,
      bucketCount: current.length,
      baselineMean: Math.round(mean * 100) / 100,
      baselineStd: Math.round(sd * 100) / 100,
      zScore: Math.round(z * 100) / 100,
      thresholdZScore: VELOCITY_Z_THRESHOLD,
      minimumBucketCount: MIN_BUCKET_COUNT,
      involvedTxnIds: current.map((t) => t.txnId),
    },
  };
}

export function detectRepeatedAmounts({ provider, recentTxns, now = new Date() }) {
  const windowStart = new Date(now.getTime() - WINDOW_MIN * 60_000);
  const windowTxns = recentTxns.filter(
    (t) => t.type === 'cash_out' && t.status === 'success' && t.timestamp >= windowStart
  );

  const groups = new Map(); // roundedAmount -> txns
  for (const t of windowTxns) {
    const key = Math.round(t.amount / 100) * 100;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(t);
  }

  for (const [amount, txns] of groups) {
    const distinctAccounts = new Set(txns.map((t) => t.customerHash)).size;
    if (txns.length >= MIN_REPEAT_COUNT && distinctAccounts <= MAX_DISTINCT_ACCOUNTS) {
      return {
        subtype: 'repeated_amount',
        provider,
        severity: 'warning',
        confidence: 0.7,
        evidence: {
          provider,
          amount,
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
  return findings.map((f) => ({ ...f, possibleNormalReasons: NORMAL_REASONS, requiresReview: true }));
}
