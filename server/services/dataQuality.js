import { signedDelta } from './signedDelta.js';

/*
  Data-quality / safe-fallback engine (Scenario C).
  Bad data must LOWER confidence and produce a data_quality alert —
  never a confident recommendation off a broken feed.
*/
const STALE_MIN = 10;
const MISMATCH_TOLERANCE = 1; // BDT

export function checkStaleFeeds(agent, now = new Date()) {
  const findings = [];
  for (const p of agent.providers) {
    const last = agent.lastFeedAt?.get ? agent.lastFeedAt.get(p.provider) : agent.lastFeedAt?.[p.provider];
    if (!last) continue;
    const ageMin = (now - new Date(last)) / 60_000;
    if (ageMin > STALE_MIN) {
      findings.push({
        subtype: 'stale_feed',
        provider: p.provider,
        severity: 'warning',
        confidence: 0.8, // confident the feed is stale; downstream forecasts get dimmed
        evidence: { provider: p.provider, lastFeedAt: last, ageMinutes: Math.round(ageMin), thresholdMinutes: STALE_MIN },
      });
    }
  }
  return findings;
}

/* opening + Σ signedDelta must equal current (within tolerance) — else the feed conflicts. */
export function checkBalanceMismatch(agent, txnsByProvider) {
  const findings = [];
  for (const p of agent.providers) {
    const txns = txnsByProvider[p.provider] || [];
    const netFlow = txns.reduce((s, t) => s + signedDelta(t).emoney, 0);
    const expected = p.openingBalance + netFlow;
    const deltaAbs = Math.abs(expected - p.emoneyBalance);
    if (deltaAbs > MISMATCH_TOLERANCE) {
      findings.push({
        subtype: 'balance_mismatch',
        provider: p.provider,
        severity: 'warning',
        confidence: 0.6,
        evidence: {
          provider: p.provider,
          expected: Math.round(expected),
          actual: p.emoneyBalance,
          deltaAbs: Math.round(deltaAbs),
          tolerance: MISMATCH_TOLERANCE,
        },
      });
    }
  }
  return findings;
}

export function staleProviderSet(agent, now = new Date()) {
  return new Set(checkStaleFeeds(agent, now).map((f) => f.provider));
}
