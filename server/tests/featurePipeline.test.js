import test from 'node:test';
import assert from 'node:assert/strict';
import { buildFeatureSnapshot, FEATURE_COLUMNS, FEATURE_SCHEMA_VERSION } from '../services/ml/featurePipeline.js';

function baseAgent(now) {
  return {
    cashBalance: 20_000,
    cashOpeningBalance: 25_000,
    cashFloorThreshold: 8_000,
    cashCriticalThreshold: 4_000,
    providers: [{ provider: 'bKash', emoneyBalance: 10_000, openingBalance: 12_000, floorThreshold: 3_000, criticalThreshold: 1_500 }],
    lastFeedAt: new Map([['bKash', now]]),
  };
}

test('throws for an unsupported provider', () => {
  const now = new Date('2026-07-11T10:00:00.000Z');
  assert.throws(
    () => buildFeatureSnapshot({ agent: baseAgent(now), provider: 'Unknown', asOf: now }),
    /Unsupported provider/,
  );
});

test('throws when asOf is not a valid date', () => {
  const now = new Date('2026-07-11T10:00:00.000Z');
  assert.throws(
    () => buildFeatureSnapshot({ agent: baseAgent(now), provider: 'bKash', asOf: 'not-a-date' }),
    /asOf must be a valid date/,
  );
});

test('resolves feedTimestamp from a plain object (not a Map)', () => {
  const now = new Date('2026-07-11T10:00:00.000Z');
  const agent = {
    ...baseAgent(now),
    lastFeedAt: { bKash: now },
  };
  const snapshot = buildFeatureSnapshot({ agent, provider: 'bKash', asOf: now });
  assert.equal(snapshot.values.feed_missing, 0);
  assert.ok(snapshot.values.feed_delay_min >= 0);
});

test('feed_missing is 1 when no feed timestamp is present for the provider', () => {
  const now = new Date('2026-07-11T10:00:00.000Z');
  const agent = { ...baseAgent(now), lastFeedAt: new Map() };
  const snapshot = buildFeatureSnapshot({ agent, provider: 'bKash', asOf: now });
  assert.equal(snapshot.values.feed_missing, 1);
});

test('is_weekend=1 and is_unusual_hour=1 on Saturday at 03:00 UTC', () => {
  const saturday3am = new Date('2026-07-11T03:00:00.000Z');
  const agent = { ...baseAgent(saturday3am), lastFeedAt: new Map([['bKash', saturday3am]]) };
  const snapshot = buildFeatureSnapshot({ agent, provider: 'bKash', asOf: saturday3am });
  assert.equal(snapshot.values.is_weekend, 1);
  assert.equal(snapshot.values.is_unusual_hour, 1);
});

test('is_weekend=0 on a weekday at a normal hour', () => {
  // 2026-07-07 is a Tuesday, 14:00 UTC is within normal hours
  const tuesday2pm = new Date('2026-07-07T14:00:00.000Z');
  const agent = { ...baseAgent(tuesday2pm), lastFeedAt: new Map([['bKash', tuesday2pm]]) };
  const snapshot = buildFeatureSnapshot({ agent, provider: 'bKash', asOf: tuesday2pm });
  assert.equal(snapshot.values.is_weekend, 0);
  assert.equal(snapshot.values.is_unusual_hour, 0);
});

test('context flags (salaryDay, eid, localEvent) are reflected in the snapshot', () => {
  const now = new Date('2026-07-11T10:00:00.000Z');
  const agent = {
    cashBalance: 20_000, cashFloorThreshold: 5_000,
    providers: [{ provider: 'Rocket', emoneyBalance: 8_000, floorThreshold: 2_000 }],
    lastFeedAt: new Map([['Rocket', now]]),
  };
  const snapshot = buildFeatureSnapshot({
    agent, provider: 'Rocket', asOf: now,
    context: { salaryDay: true, eid: true, localEvent: true, previousShortageCount: 3 },
  });
  assert.equal(snapshot.values.is_salary_day, 1);
  assert.equal(snapshot.values.is_eid_event, 1);
  assert.equal(snapshot.values.is_local_event, 1);
  assert.equal(snapshot.values.previous_shortage_count, 3);
});

test('derived ratios default to zero when denominators are zero (no transactions)', () => {
  const now = new Date('2026-07-11T10:00:00.000Z');
  const snapshot = buildFeatureSnapshot({ agent: baseAgent(now), provider: 'bKash', asOf: now });
  assert.equal(snapshot.values.baseline_count_deviation, 0);
  assert.equal(snapshot.values.demand_acceleration, 0);
  assert.equal(snapshot.values.provider_share_30m, 0);
  assert.equal(snapshot.values.velocity_ratio, 0);
});

test('provider_share_30m reflects the provider fraction of total cross-provider cash-out', () => {
  const now = new Date('2026-07-11T10:00:00.000Z');
  const agent = {
    cashBalance: 50_000, cashFloorThreshold: 10_000,
    providers: [
      { provider: 'bKash', emoneyBalance: 20_000, floorThreshold: 5_000 },
      { provider: 'Nagad', emoneyBalance: 20_000, floorThreshold: 5_000 },
    ],
    lastFeedAt: new Map([['bKash', now], ['Nagad', now]]),
  };
  const txns = [
    { provider: 'bKash', type: 'cash_out', amount: 3_000, status: 'success', customerHash: 'A', timestamp: new Date(now.getTime() - 10 * 60_000) },
    { provider: 'Nagad', type: 'cash_out', amount: 7_000, status: 'success', customerHash: 'B', timestamp: new Date(now.getTime() - 10 * 60_000) },
  ];
  const snapshot = buildFeatureSnapshot({ agent, provider: 'bKash', transactions: txns, asOf: now });
  assert.ok(Math.abs(snapshot.values.provider_share_30m - 0.3) < 0.001);
});

test('std and amount metrics are computed correctly when multiple successful transactions exist', () => {
  const now = new Date('2026-07-11T10:00:00.000Z');
  // Space transactions at 4-minute intervals so only the first falls in the 5m window
  const txns = [500, 1_000, 1_500, 2_000].map((amount, i) => ({
    provider: 'bKash', type: 'cash_out', amount, status: 'success',
    customerHash: `C-${i}`, timestamp: new Date(now.getTime() - (i + 1) * 4 * 60_000),
  }));
  const snapshot = buildFeatureSnapshot({ agent: baseAgent(now), provider: 'bKash', transactions: txns, asOf: now });
  assert.equal(snapshot.values.txn_count_5m, 1);
  assert.ok(snapshot.values.amount_std_60m > 0);
  assert.equal(snapshot.values.max_amount_60m, 2_000);
});

test('sameHourBaseline populates historical features and velocity_ratio is non-zero with current activity', () => {
  const now = new Date('2026-07-11T10:00:00.000Z');
  const yesterday10am = new Date('2026-07-10T10:30:00.000Z');
  const txns = [
    { provider: 'bKash', type: 'cash_out', amount: 800, status: 'success', customerHash: 'H1', timestamp: yesterday10am },
    { provider: 'bKash', type: 'cash_out', amount: 400, status: 'success', customerHash: 'H2', timestamp: new Date(yesterday10am.getTime() + 10 * 60_000) },
    // Current 5m activity to make velocity_ratio non-zero
    { provider: 'bKash', type: 'cash_out', amount: 600, status: 'success', customerHash: 'C-now', timestamp: new Date(now.getTime() - 3 * 60_000) },
  ];
  const snapshot = buildFeatureSnapshot({ agent: baseAgent(now), provider: 'bKash', transactions: txns, asOf: now });
  assert.ok(snapshot.values.historical_count_same_hour > 0);
  assert.ok(snapshot.values.historical_amount_same_hour > 0);
  assert.ok(snapshot.values.velocity_ratio > 0);
  assert.equal(snapshot.metadata.baselineCount, snapshot.values.historical_count_same_hour);
});

test('Nagad and Rocket provider indicator bits are set correctly', () => {
  const now = new Date('2026-07-11T10:00:00.000Z');
  const agent = {
    cashBalance: 20_000, cashFloorThreshold: 5_000,
    providers: [{ provider: 'Nagad', emoneyBalance: 8_000, floorThreshold: 2_000 }],
    lastFeedAt: new Map([['Nagad', now]]),
  };
  const snap = buildFeatureSnapshot({ agent, provider: 'Nagad', asOf: now });
  assert.equal(snap.values.provider_bkash, 0);
  assert.equal(snap.values.provider_nagad, 1);
  assert.equal(snap.values.provider_rocket, 0);
});

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
