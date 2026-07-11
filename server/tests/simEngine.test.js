import test from 'node:test';
import assert from 'node:assert/strict';
import { applyTxnsToState, scenarioTxns } from '../services/simEngine.js';
import { detectAnomalies } from '../services/anomaly.js';
import { signedDelta } from '../services/signedDelta.js';

/*
  Money-integrity + scenario-reliability guarantees, tested without a DB
  (applyTxnsToState is the pure core of the persistence writer).
*/

const mkAgent = () => ({
  cashBalance: 5000,
  providers: [{ provider: 'bKash', emoneyBalance: 3000 }],
  lastFeedAt: new Map(),
});
const mkTxn = (over) => ({
  txnId: 'T-1', agentId: 'A', provider: 'bKash', type: 'cash_out', amount: 1000,
  status: 'success', customerHash: 'C-1', timestamp: new Date(), ...over,
});

test('a cash-out the drawer cannot cover FAILS with insufficient_funds — nothing moves, no clamping', () => {
  const agent = mkAgent();
  const [t] = applyTxnsToState(agent, [mkTxn({ amount: 6000 })]); // drawer holds 5000
  assert.equal(t.status, 'failed');
  assert.equal(t.failureReason, 'insufficient_funds');
  assert.equal(agent.cashBalance, 5000, 'cash unchanged');
  assert.equal(agent.providers[0].emoneyBalance, 3000, 'e-money unchanged — no one-sided credit');
});

test('a cash-in the float cannot cover FAILS — e-money never goes negative', () => {
  const agent = mkAgent();
  const [t] = applyTxnsToState(agent, [mkTxn({ type: 'cash_in', amount: 4000 })]); // float holds 3000
  assert.equal(t.status, 'failed');
  assert.equal(agent.cashBalance, 5000);
  assert.equal(agent.providers[0].emoneyBalance, 3000);
});

test('a covered transaction moves both sides consistently', () => {
  const agent = mkAgent();
  applyTxnsToState(agent, [mkTxn({ amount: 2000 })]); // cash_out: cash ↓, e-money ↑
  assert.equal(agent.cashBalance, 3000);
  assert.equal(agent.providers[0].emoneyBalance, 5000);
});

test('pending transactions move NO balances (only success settles)', () => {
  assert.deepEqual(signedDelta(mkTxn({ status: 'pending' })), { cash: 0, emoney: 0 });
  const agent = mkAgent();
  applyTxnsToState(agent, [mkTxn({ status: 'pending', amount: 2000 })]);
  assert.equal(agent.cashBalance, 5000);
  assert.equal(agent.providers[0].emoneyBalance, 3000);
});

test('feed freshness moves with the write — except the intentionally stale provider (Scenario C)', () => {
  const agent = mkAgent();
  const now = new Date();
  applyTxnsToState(agent, [mkTxn()], { staleProvider: 'bKash', now });
  assert.equal(agent.lastFeedAt.get('bKash'), undefined);
  applyTxnsToState(agent, [mkTxn()], { now });
  assert.equal(agent.lastFeedAt.get('bKash'), now);
});

/*
  Scenario B reliability: the bKash burst must flag for review; the Rocket
  "bigger but organic" contrast must NEVER become a review flag, no matter how
  long the demo runs (it may surface as demand_surge — info-level context).
  Simulates 60 ticks (~2 demo minutes) of generated transactions.
*/
test('Scenario B contrast holds over a long run: bKash flags, Rocket never flags for review', () => {
  const start = Date.now();
  const all = [];
  for (let tick = 1; tick <= 60; tick++) {
    all.push(...scenarioTxns('B', 'AGT-001', new Date(start + tick * 2000), tick));
  }
  const now = new Date(start + 61 * 2000);

  // Baseline like the seeded history: ~1 cash-out every 2-6 min for 3h before the demo
  const baseline = [];
  for (let m = 180; m > 60; m -= 4) {
    baseline.push(mkTxn({ txnId: `B-${m}`, timestamp: new Date(start - m * 60_000), amount: 500 + (m % 50) * 100, customerHash: `CUST-${m}` }));
  }

  const byProvider = (p) => all.filter((t) => t.provider === p);

  const bkash = detectAnomalies({ provider: 'bKash', recentTxns: byProvider('bKash'), baselineTxns: baseline, now });
  assert.ok(bkash.some((f) => f.requiresReview !== false), 'bKash concentrated burst must flag for review');

  const rocket = detectAnomalies({ provider: 'Rocket', recentTxns: byProvider('Rocket'), baselineTxns: baseline, now });
  const rocketReviewFlags = rocket.filter((f) => f.requiresReview !== false);
  assert.equal(rocketReviewFlags.length, 0,
    `Rocket organic burst must never flag for review (got: ${rocketReviewFlags.map((f) => f.subtype).join(', ')})`);
});
