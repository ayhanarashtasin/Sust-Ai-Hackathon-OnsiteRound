import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateDecisionSupport } from '../services/ml/decisionSupport.js';

/*
  evaluateDecisionSupport runs the full per-provider pipeline (data quality ->
  forecast -> feature snapshot -> rule engine -> ONNX model -> hybrid decision ->
  evidence/next-step annotation) WITHOUT touching the database when
  persistPredictions is false (persistence is the only DB path). These tests
  exercise it against synthetic in-memory inputs and the committed ONNX artifacts.
*/

const PROVIDERS = ['bKash', 'Nagad', 'Rocket'];

// Balanced cash_out/cash_in pair per provider => net zero flow, so a clean
// agent reconciles (no spurious balance_mismatch) and providers stay separate.
function cleanAgent(now) {
  const providers = PROVIDERS.map((provider) => ({
    provider, emoneyBalance: 60_000, openingBalance: 60_000, floorThreshold: 5_000, criticalThreshold: 2_500,
  }));
  return {
    agentId: 'AGT-TEST', area: 'Testville',
    cashBalance: 100_000, cashOpeningBalance: 100_000, cashFloorThreshold: 12_000, cashCriticalThreshold: 6_000,
    providers,
    lastFeedAt: new Map(PROVIDERS.map((provider) => [provider, now])),
  };
}

function balancedTxns(now) {
  const txns = [];
  let seq = 0;
  for (const provider of PROVIDERS) {
    for (let i = 0; i < 6; i++) {
      const ts = new Date(now.getTime() - (i + 1) * 60_000);
      const amount = 1_000;
      txns.push({ txnId: `T-${++seq}`, provider, type: 'cash_out', amount, status: 'success', customerHash: `C-${i}`, timestamp: ts });
      txns.push({ txnId: `T-${++seq}`, provider, type: 'cash_in', amount, status: 'success', customerHash: `C-${i}`, timestamp: ts });
    }
  }
  return txns;
}

test('evaluateDecisionSupport returns a decision per provider + a forecast per resource (no DB)', async () => {
  const now = new Date('2026-07-11T15:00:00.000Z');
  const agent = cleanAgent(now);
  const result = await evaluateDecisionSupport({ agent, transactions: balancedTxns(now), now, persistPredictions: false });

  assert.equal(result.agentId, 'AGT-TEST');
  assert.equal(result.simulated, true);
  assert.equal(result.providerDecisions.length, 3);
  assert.equal(result.forecasts.length, 4); // shared cash + 3 providers
  assert.equal(typeof result.modelAvailable, 'boolean');

  for (const decision of result.providerDecisions) {
    for (const task of [decision.liquidity, decision.anomaly]) {
      assert.ok(task.riskScore >= 0 && task.riskScore <= 1);
      assert.ok(['low', 'medium', 'high', 'critical', 'unknown'].includes(task.riskBand));
      assert.ok(Array.isArray(task.evidence) && task.evidence.length === 5);
      assert.equal(typeof task.safeNextStep, 'string');
      assert.ok(task.dataFreshness.status === 'fresh' || task.dataFreshness.status === 'requires_review');
    }
  }
  // mainPressure is the highest-band decision across all providers
  assert.ok(result.mainPressure === null || typeof result.mainPressure.riskScore === 'number');
});

test('an agent with no providers produces empty decisions and a null main pressure', async () => {
  const now = new Date('2026-07-11T15:00:00.000Z');
  const agent = {
    agentId: 'AGT-EMPTY',
    cashBalance: 50_000, cashOpeningBalance: 50_000, cashFloorThreshold: 10_000, cashCriticalThreshold: 5_000,
    providers: [],
    lastFeedAt: new Map(),
  };
  const result = await evaluateDecisionSupport({ agent, transactions: [], now, persistPredictions: false });
  assert.equal(result.providerDecisions.length, 0);
  assert.equal(result.mainPressure, null);
  assert.equal(result.modelAvailable, false);
});

test('cash-critical scenario surfaces a critical-band main pressure', async () => {
  const now = new Date('2026-07-11T15:00:00.000Z');
  const agent = {
    agentId: 'AGT-CRIT',
    cashBalance: 100,
    cashOpeningBalance: 50_000,
    cashFloorThreshold: 10_000,
    cashCriticalThreshold: 5_000,
    providers: [{ provider: 'bKash', emoneyBalance: 50_000, openingBalance: 50_000, floorThreshold: 5_000, criticalThreshold: 2_500 }],
    lastFeedAt: new Map([['bKash', now]]),
  };
  const result = await evaluateDecisionSupport({ agent, transactions: [], now, persistPredictions: false });
  assert.ok(result.mainPressure != null);
  assert.equal(result.mainPressure.riskBand, 'critical');
});

test('anomaly safeNextStep message is advisory when there are no data quality issues', async () => {
  const now = new Date('2026-07-11T15:00:00.000Z');
  const agent = cleanAgent(now);
  const result = await evaluateDecisionSupport({ agent, transactions: balancedTxns(now), now, persistPredictions: false });
  const nagad = result.providerDecisions.find((d) => d.provider === 'Nagad');
  assert.match(nagad.anomaly.safeNextStep, /Review the unusual transaction evidence/);
});

test('a stale + missing feed lowers data confidence and switches the next step to verification', async () => {
  const now = new Date('2026-07-11T15:00:00.000Z');
  const agent = cleanAgent(now);
  // bKash feed is old (stale); Rocket has no feed timestamp at all (missing).
  agent.lastFeedAt = new Map([
    ['bKash', new Date(now.getTime() - 45 * 60_000)],
    ['Nagad', now],
  ]);
  // Nudge bKash off-book to also force a balance_mismatch on that provider.
  agent.providers.find((p) => p.provider === 'bKash').emoneyBalance += 9_999;

  const result = await evaluateDecisionSupport({ agent, transactions: balancedTxns(now), now, persistPredictions: false });

  const issues = result.dataQuality.issuesByProvider;
  assert.ok((issues.bKash || []).length > 0, 'bKash should have data issues');
  assert.ok((issues.Rocket || []).includes('missing_feed'), 'Rocket feed is missing');

  const bkash = result.providerDecisions.find((d) => d.provider === 'bKash');
  assert.equal(bkash.liquidity.dataFreshness.status, 'requires_review');
  assert.match(bkash.liquidity.safeNextStep, /Verify the bKash feed/);
  assert.ok(bkash.liquidity.dataConfidence < 1, 'data confidence is reduced under data issues');
});
