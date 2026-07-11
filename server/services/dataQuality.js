import { signedDelta } from './signedDelta.js';

/*
  Data-quality / safe-fallback engine (Scenario C).
  Bad data must LOWER confidence, SUPPRESS recommendations, and produce a
  data_quality alert — never a confident recommendation off a broken feed.

  Three failure modes, each a distinct finding:
    stale_feed       — provider sent data, but not recently
    missing_feed     — provider has NO feed timestamp at all (least trusted state)
    balance_mismatch — opening + Σ signedDelta disagrees with the reported balance

  providerDataIssues() is the single source of truth the forecast consumes:
  every issue both dims confidence and withholds the top-up recommendation.
*/
export const STALE_MIN = 10;
const MISMATCH_TOLERANCE = 1; // BDT

export function checkStaleFeeds(agent, now = new Date()) {
  const findings = [];
  for (const p of agent.providers) {
    const last = agent.lastFeedAt?.get ? agent.lastFeedAt.get(p.provider) : agent.lastFeedAt?.[p.provider];
    if (!last) {
      // A feed we have NEVER heard from is not fresh — it is the least trusted state.
      findings.push({
        subtype: 'missing_feed',
        provider: p.provider,
        severity: 'warning',
        confidence: 0.8,
        evidence: { provider: p.provider, lastFeedAt: null, thresholdMinutes: STALE_MIN },
      });
      continue;
    }
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

/*
  Unified issue map: provider -> ['stale_feed' | 'missing_feed' | 'balance_mismatch', ...]
  plus the findings themselves. The forecast dims confidence AND suppresses
  recommendations for any provider present in this map (and for shared cash,
  which mixes every provider's flow).
*/
export function providerDataIssues(agent, txnsByProvider, now = new Date()) {
  const findings = [...checkStaleFeeds(agent, now), ...checkBalanceMismatch(agent, txnsByProvider)];
  const issuesByProvider = {};
  for (const f of findings) {
    (issuesByProvider[f.provider] ||= []).push(f.subtype);
  }
  return { issuesByProvider, findings };
}

export function staleProviderSet(agent, now = new Date()) {
  return new Set(checkStaleFeeds(agent, now).map((f) => f.provider));
}
