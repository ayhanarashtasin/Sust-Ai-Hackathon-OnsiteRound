import test from 'node:test';
import assert from 'node:assert/strict';
import { checkStaleFeeds, checkBalanceMismatch, providerDataIssues } from '../services/dataQuality.js';
import { computeForecast, forecastAgent } from '../services/forecast.js';

/*
  MANDATORY safe-fallback behavior (Scenario C): missing / late / conflicting
  provider data must lower confidence AND withhold recommendations — the system
  never tells anyone to move money based on broken data.
*/

const now = new Date('2026-07-11T15:00:00.000Z');
const mkAgent = (lastFeedAt) => ({
  cashBalance: 50000, cashFloorThreshold: 10000,
  providers: [
    { provider: 'bKash', emoneyBalance: 40000, openingBalance: 40000, floorThreshold: 5000 },
    { provider: 'Rocket', emoneyBalance: 30000, openingBalance: 30000, floorThreshold: 5000 },
  ],
  lastFeedAt,
});

let seq = 0;
const drainTxns = (provider, perMin = 500, mins = 30) => {
  const out = [];
  for (let m = 1; m <= mins; m++) {
    out.push({ txnId: `T-${++seq}`, provider, type: 'cash_in', amount: perMin, status: 'success', customerHash: 'C-1', timestamp: new Date(now - m * 60_000) });
  }
  return out;
};

test('missing feed timestamp is NOT silently ignored — reported as missing_feed', () => {
  const agent = mkAgent(new Map([['bKash', now]])); // Rocket has NO timestamp at all
  const findings = checkStaleFeeds(agent, now);
  const missing = findings.find((f) => f.subtype === 'missing_feed');
  assert.ok(missing, 'expected a missing_feed finding');
  assert.equal(missing.provider, 'Rocket');
});

test('stale feed (older than threshold) is reported with age evidence', () => {
  const agent = mkAgent(new Map([['bKash', now], ['Rocket', new Date(now - 15 * 60_000)]]));
  const findings = checkStaleFeeds(agent, now);
  const stale = findings.find((f) => f.subtype === 'stale_feed');
  assert.equal(stale.provider, 'Rocket');
  assert.equal(stale.evidence.ageMinutes, 15);
});

test('balance conflict is included in the provider issue map (dims + suppresses downstream)', () => {
  const agent = mkAgent(new Map([['bKash', now], ['Rocket', now]]));
  agent.providers[1].emoneyBalance += 7777; // off-book nudge, no matching txns
  const { issuesByProvider, findings } = providerDataIssues(agent, { bKash: [], Rocket: [] }, now);
  assert.deepEqual(issuesByProvider.Rocket, ['balance_mismatch']);
  assert.ok(findings.some((f) => f.subtype === 'balance_mismatch'));
});

test('data issues SUPPRESS the top-up recommendation, not just dim confidence (mandatory fallback)', () => {
  const txns = drainTxns('Rocket');
  const clean = computeForecast({ resource: 'emoney', provider: 'Rocket', currentBalance: 20000, floorThreshold: 5000, txns, now });
  const broken = computeForecast({ resource: 'emoney', provider: 'Rocket', currentBalance: 20000, floorThreshold: 5000, txns, now, dataIssues: ['stale_feed'] });
  assert.ok(clean.suggestedTopUp > 0, 'clean feed should recommend a top-up');
  assert.equal(broken.suggestedTopUp, 0, 'broken feed must NOT recommend a top-up');
  assert.equal(broken.recommendationSuppressed, true);
  assert.ok(broken.confidence < clean.confidence);
});

test('balance_mismatch dims forecast confidence for the affected provider', () => {
  const txns = drainTxns('Rocket');
  const clean = computeForecast({ resource: 'emoney', provider: 'Rocket', currentBalance: 20000, floorThreshold: 5000, txns, now });
  const conflicted = computeForecast({ resource: 'emoney', provider: 'Rocket', currentBalance: 20000, floorThreshold: 5000, txns, now, dataIssues: ['balance_mismatch'] });
  assert.ok(conflicted.confidence < clean.confidence);
  assert.equal(conflicted.recommendationSuppressed, true);
});

test('shared cash inherits every provider issue (its flow mixes all feeds)', () => {
  const agent = mkAgent(new Map([['bKash', now]])); // Rocket missing
  const txnsByProvider = { bKash: drainTxns('bKash', 400), Rocket: [] };
  agent.providers[0].emoneyBalance = 40000 - 400 * 30; // consistent with the drain history
  const { issuesByProvider } = providerDataIssues(agent, txnsByProvider, now);
  const forecasts = forecastAgent(agent, txnsByProvider, now, issuesByProvider);
  const cash = forecasts.find((f) => f.resource === 'cash');
  assert.equal(cash.recommendationSuppressed, true);
  assert.deepEqual(cash.dataIssues, ['missing_feed']);
});
