import test from 'node:test';
import assert from 'node:assert/strict';
import { buildFeatureSnapshot, FEATURE_COLUMNS, FEATURE_SCHEMA_VERSION } from '../services/ml/featurePipeline.js';

test('feature snapshot is point-in-time, finite, and uses the declared schema', () => {
  const now = new Date('2026-07-11T10:00:00.000Z');
  const agent = {
    cashBalance: 20_000,
    cashFloorThreshold: 12_000,
    cashCriticalThreshold: 6_000,
    providers: [{ provider: 'bKash', emoneyBalance: 8_000, floorThreshold: 5_000, criticalThreshold: 2_500, dataReceivedAt: now }],
    lastFeedAt: new Map([['bKash', now]]),
  };
  const transactions = [
    { provider: 'bKash', type: 'cash_out', amount: 1_000, status: 'success', customerHash: 'A', timestamp: new Date(now.getTime() - 4 * 60_000) },
    { provider: 'bKash', type: 'cash_in', amount: 50_000, status: 'success', customerHash: 'FUTURE', timestamp: new Date(now.getTime() + 5 * 60_000) },
  ];
  const snapshot = buildFeatureSnapshot({ agent, provider: 'bKash', transactions, asOf: now });
  assert.equal(snapshot.schemaVersion, FEATURE_SCHEMA_VERSION);
  assert.equal(snapshot.vector.length, FEATURE_COLUMNS.length);
  assert.equal(snapshot.values.txn_count_5m, 1);
  assert.equal(snapshot.values.cash_in_amount_5m, 0, 'future transaction must not leak into the feature row');
  assert.ok(snapshot.vector.every(Number.isFinite));
});
