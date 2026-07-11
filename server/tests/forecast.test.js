import test from 'node:test';
import assert from 'node:assert/strict';
import { computeForecast } from '../services/forecast.js';

let seq = 0;
const txn = (type, amount, minsAgo, now) => ({
  txnId: `T-${++seq}`, provider: 'bKash', type, amount, status: 'success',
  customerHash: 'CUST-1', timestamp: new Date(now - minsAgo * 60_000),
});

test('zero burn => stable, no depletion projection (divide-by-zero guard)', () => {
  const now = Date.now();
  // cash_out INCREASES e-money — no e-money drain
  const txns = [txn('cash_out', 2000, 5, now), txn('cash_out', 1500, 10, now)];
  const f = computeForecast({ resource: 'emoney', provider: 'bKash', currentBalance: 30000, floorThreshold: 5000, txns, now: new Date(now) });
  assert.equal(f.status, 'stable');
  assert.equal(f.timeToDepletionMin, null);
  assert.equal(f.suggestedTopUp, 0);
});

test('steady drain => correct depletion ETA + quantified topUp', () => {
  const now = Date.now();
  const txns = [];
  // 500/min e-money drain via cash_in over the 30-min window => netFlow -15000
  for (let m = 1; m <= 30; m++) txns.push(txn('cash_in', 500, m, now));
  const f = computeForecast({ resource: 'emoney', provider: 'bKash', currentBalance: 20000, floorThreshold: 5000, txns, now: new Date(now) });
  assert.equal(f.burnRatePerMin, 500);
  assert.equal(f.timeToDepletionMin, 30); // (20000-5000)/500
  assert.equal(f.status, 'warning'); // boundary is strictly <30 for critical, so 30 => warning
});

test('threshold boundaries: <30 critical, <120 warning', () => {
  const now = Date.now();
  const txns = [];
  for (let m = 1; m <= 30; m++) txns.push(txn('cash_in', 1000, m, now));
  const critical = computeForecast({ resource: 'emoney', provider: 'bKash', currentBalance: 15000, floorThreshold: 5000, txns, now: new Date(now) });
  assert.equal(critical.status, 'critical'); // 10min headroom
  const warning = computeForecast({ resource: 'emoney', provider: 'bKash', currentBalance: 105000, floorThreshold: 5000, txns, now: new Date(now) });
  assert.equal(warning.status, 'warning'); // 100min
});

test('suggestedTopUp = 2h projected outflow minus headroom, rounded to 1000', () => {
  const now = Date.now();
  const txns = [];
  for (let m = 1; m <= 30; m++) txns.push(txn('cash_in', 500, m, now));
  const f = computeForecast({ resource: 'emoney', provider: 'bKash', currentBalance: 20000, floorThreshold: 5000, txns, now: new Date(now) });
  // outflow2h = 500*120 = 60000; headroom = 15000; gap = 45000
  assert.equal(f.suggestedTopUp, 45000);
});

test('stale feed dims confidence', () => {
  const now = Date.now();
  const txns = [];
  for (let m = 1; m <= 30; m++) txns.push(txn('cash_in', 500, m, now));
  const fresh = computeForecast({ resource: 'emoney', provider: 'bKash', currentBalance: 20000, floorThreshold: 5000, txns, now: new Date(now), feedStale: false });
  const stale = computeForecast({ resource: 'emoney', provider: 'bKash', currentBalance: 20000, floorThreshold: 5000, txns, now: new Date(now), feedStale: true });
  assert.ok(stale.confidence < fresh.confidence);
});
