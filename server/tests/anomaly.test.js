import test from 'node:test';
import assert from 'node:assert/strict';
import { detectRepeatedAmounts, detectVelocitySpike, detectAnomalies } from '../services/anomaly.js';

let seq = 0;
const txn = (over) => ({
  txnId: `T-${++seq}`, provider: 'bKash', type: 'cash_out', amount: 2000,
  status: 'success', customerHash: `CUST-${seq}`, timestamp: new Date(), ...over,
});

test('repeated near-identical amounts from few accounts => flagged with evidence', () => {
  const now = new Date();
  const txns = [];
  for (let i = 0; i < 6; i++) txns.push(txn({ amount: 9800, customerHash: `CUST-${i % 2}`, timestamp: new Date(now - i * 60_000) }));
  const f = detectRepeatedAmounts({ provider: 'bKash', recentTxns: txns, now });
  assert.ok(f);
  assert.equal(f.evidence.repeatCount, 6);
  assert.equal(f.evidence.distinctAccounts, 2);
  assert.equal(f.evidence.minimumRepeatCount, 5);
  assert.equal(f.evidence.maximumDistinctAccounts, 3);
  assert.equal(f.evidence.involvedTxnIds.length, 6);
});

test('normal Eid burst (varied amounts, many accounts) does NOT flag — false-positive contrast', () => {
  const now = new Date();
  const txns = [];
  for (let i = 0; i < 12; i++) txns.push(txn({ amount: 700 + i * 517, customerHash: `CUST-${1000 + i}`, timestamp: new Date(now - i * 2 * 60_000) }));
  const f = detectRepeatedAmounts({ provider: 'bKash', recentTxns: txns, now });
  assert.equal(f, null);
});

test('velocity spike vs baseline => z-score evidence', () => {
  const now = new Date();
  const baseline = [];
  // ~2 cash_outs per 5-min bucket for 3h
  for (let m = 180; m > 10; m -= 2.5) baseline.push(txn({ timestamp: new Date(now - m * 60_000) }));
  const burst = [];
  for (let i = 0; i < 15; i++) burst.push(txn({ timestamp: new Date(now - i * 15_000) }));
  const f = detectVelocitySpike({ provider: 'bKash', recentTxns: burst, baselineTxns: baseline, now });
  assert.ok(f);
  assert.ok(f.evidence.zScore > 3);
  assert.equal(f.evidence.thresholdZScore, 3);
  assert.equal(f.evidence.minimumBucketCount, 6);
});

test('insufficient history => safe fallback: no flag', () => {
  const now = new Date();
  const burst = [];
  for (let i = 0; i < 15; i++) burst.push(txn({ timestamp: new Date(now - i * 15_000) }));
  const f = detectVelocitySpike({ provider: 'bKash', recentTxns: burst, baselineTxns: [], now });
  assert.equal(f, null);
});

test('anomaly findings always carry review framing, never a determination', () => {
  const now = new Date();
  const txns = [];
  for (let i = 0; i < 6; i++) txns.push(txn({ amount: 9800, customerHash: 'CUST-1', timestamp: new Date(now - i * 60_000) }));
  const findings = detectAnomalies({ provider: 'bKash', recentTxns: txns, baselineTxns: [], now });
  for (const f of findings) {
    assert.equal(f.requiresReview, true);
    assert.ok(f.possibleNormalReasons.length > 0);
  }
});
