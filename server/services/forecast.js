import { signedDelta } from './signedDelta.js';

/*
  Liquidity forecast pipeline (runs per resource on every sim tick — compute-on-write):

    txns in 30-min window
        │ signedDelta per txn
        ▼
    netFlow (BDT) ──▶ burnRate = -netFlow/window   (only when draining)
        │
        ▼
    timeToDepletion = (balance - floor) / burnRate
        │
        ▼
    confidence (0.1..0.9) dims on: small sample, volatile rate, stale feed
        │
        ▼
    suggestedTopUp = max(0, burnRate×120 - (balance - floor))  → rounded up to ৳1,000
*/
export const WINDOW_MIN = 30;
export const CRITICAL_DEPLETION_MIN = 30;
export const WARNING_DEPLETION_MIN = 120;

export function computeForecast({ resource, provider, currentBalance, floorThreshold, txns, now = new Date(), feedStale = false }) {
  const windowStart = new Date(now.getTime() - WINDOW_MIN * 60_000);
  const windowTxns = txns.filter((t) => t.timestamp >= windowStart && t.status === 'success');

  let netFlow = 0;
  const rates = []; // per-5-min-bucket flow, for volatility
  const buckets = new Map();
  for (const t of windowTxns) {
    const d = signedDelta(t);
    const flow = resource === 'cash' ? d.cash : d.emoney;
    netFlow += flow;
    const bucket = Math.floor((now - t.timestamp) / (5 * 60_000));
    buckets.set(bucket, (buckets.get(bucket) || 0) + flow);
  }
  for (const v of buckets.values()) rates.push(v);

  const burnRatePerMin = netFlow < 0 ? -netFlow / WINDOW_MIN : 0;

  // Zero-burn guard: no drain => stable, no depletion projection (kills divide-by-zero).
  if (burnRatePerMin <= 0) {
    return {
      resource, provider, currentBalance, floorThreshold,
      burnRatePerMin: 0, sampleSize: windowTxns.length,
      status: 'stable', timeToDepletionMin: null, projectedDepletionAt: null,
      suggestedTopUp: 0, confidence: feedStale ? 0.4 : 0.9, windowMin: WINDOW_MIN,
      criticalThresholdMin: CRITICAL_DEPLETION_MIN, warningThresholdMin: WARNING_DEPLETION_MIN,
    };
  }

  const headroom = Math.max(0, currentBalance - floorThreshold);
  const timeToDepletionMin = headroom / burnRatePerMin;
  const projectedDepletionAt = new Date(now.getTime() + timeToDepletionMin * 60_000);

  // Confidence: start 0.9, dim for small sample, volatility, stale feed. Floor 0.1.
  let confidence = 0.9;
  if (windowTxns.length < 10) confidence -= 0.3;
  if (rates.length > 1) {
    const mean = rates.reduce((s, r) => s + r, 0) / rates.length;
    const sd = Math.sqrt(rates.reduce((s, r) => s + (r - mean) ** 2, 0) / rates.length);
    if (mean !== 0 && Math.abs(sd / mean) > 0.5) confidence -= 0.2;
  }
  if (feedStale) confidence -= 0.3;
  confidence = Math.max(0.1, Math.round(confidence * 100) / 100);

  // Quantified next step (matches brief's illustrative "at least ৳20,000" alert)
  const projectedOutflow2h = burnRatePerMin * 120;
  const suggestedTopUp = Math.ceil(Math.max(0, projectedOutflow2h - headroom) / 1000) * 1000;

  const status = timeToDepletionMin < CRITICAL_DEPLETION_MIN ? 'critical' : timeToDepletionMin < WARNING_DEPLETION_MIN ? 'warning' : 'ok';

  return {
    resource, provider, currentBalance, floorThreshold,
    burnRatePerMin: Math.round(burnRatePerMin), sampleSize: windowTxns.length,
    status, timeToDepletionMin: Math.round(timeToDepletionMin), projectedDepletionAt,
    suggestedTopUp, confidence, windowMin: WINDOW_MIN,
    criticalThresholdMin: CRITICAL_DEPLETION_MIN, warningThresholdMin: WARNING_DEPLETION_MIN,
  };
}

/* Forecast every resource for one agent: shared cash + each provider e-money. */
export function forecastAgent(agent, txnsByProvider, now = new Date(), staleProviders = new Set()) {
  const allTxns = Object.values(txnsByProvider).flat();
  const results = [];

  results.push(
    computeForecast({
      resource: 'cash', provider: null,
      currentBalance: agent.cashBalance, floorThreshold: agent.cashFloorThreshold,
      txns: allTxns, now, feedStale: staleProviders.size > 0,
    })
  );

  for (const p of agent.providers) {
    results.push(
      computeForecast({
        resource: 'emoney', provider: p.provider,
        currentBalance: p.emoneyBalance, floorThreshold: p.floorThreshold,
        txns: txnsByProvider[p.provider] || [], now, feedStale: staleProviders.has(p.provider),
      })
    );
  }
  return results;
}
