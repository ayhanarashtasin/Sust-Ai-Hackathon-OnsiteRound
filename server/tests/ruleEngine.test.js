import test from 'node:test';
import assert from 'node:assert/strict';
import { runRuleEngine } from '../services/rules/ruleEngine.js';

const features = {
  cash_current: 5_000,
  cash_critical: 6_000,
  cash_floor: 12_000,
  provider_balance: 3_000,
  provider_floor: 5_000,
  cash_out_amount_60m: 8_000,
  cash_burn_rate_30m: 550,
  velocity_ratio: 3,
  near_identical_count_30m: 6,
  max_txns_customer_30m: 6,
  unique_customers_30m: 2,
  feed_delay_min: 16,
  feed_missing: 0,
  balance_mismatch_amount: 0,
  cash_balance_mismatch_amount: 0,
};

const cleanFeatures = {
  cash_current: 50_000, cash_critical: 5_000, cash_floor: 10_000,
  provider_balance: 20_000, provider_floor: 5_000, cash_out_amount_60m: 1_000,
  cash_burn_rate_30m: 0, velocity_ratio: 0, near_identical_count_30m: 0,
  max_txns_customer_30m: 0, unique_customers_30m: 10, feed_delay_min: 5,
  feed_missing: 0, balance_mismatch_amount: 0, cash_balance_mismatch_amount: 0,
};

test('missing_feed in dataIssues triggers provider_feed_missing rule', () => {
  const rules = runRuleEngine({
    agent: { providers: [{ provider: 'bKash' }] }, provider: 'bKash',
    features: cleanFeatures, dataIssues: ['missing_feed'], cashIssues: [],
  });
  assert.ok(rules.triggered.some((r) => r.id === 'provider_feed_missing'));
});

test('feed_missing feature flag (=1) also triggers provider_feed_missing', () => {
  const rules = runRuleEngine({
    agent: { providers: [{ provider: 'Nagad' }] }, provider: 'Nagad',
    features: { ...cleanFeatures, feed_missing: 1 }, dataIssues: [], cashIssues: [],
  });
  assert.ok(rules.triggered.some((r) => r.id === 'provider_feed_missing'));
});

test('balance_mismatch_amount > 0 triggers balance_data_inconsistent', () => {
  const rules = runRuleEngine({
    agent: { providers: [{ provider: 'Rocket' }] }, provider: 'Rocket',
    features: { ...cleanFeatures, balance_mismatch_amount: 500 }, dataIssues: [], cashIssues: [],
  });
  assert.ok(rules.triggered.some((r) => r.id === 'balance_data_inconsistent'));
});

test('cash_balance_mismatch_amount > 0 triggers balance_data_inconsistent', () => {
  const rules = runRuleEngine({
    agent: { providers: [{ provider: 'bKash' }] }, provider: 'bKash',
    features: { ...cleanFeatures, cash_balance_mismatch_amount: 250 }, dataIssues: [], cashIssues: [],
  });
  assert.ok(rules.triggered.some((r) => r.id === 'balance_data_inconsistent'));
});

test('cashIssues balance_mismatch propagates to balance_data_inconsistent', () => {
  const rules = runRuleEngine({
    agent: { providers: [{ provider: 'bKash' }] }, provider: 'bKash',
    features: cleanFeatures, dataIssues: [], cashIssues: ['balance_mismatch'],
  });
  assert.ok(rules.triggered.some((r) => r.id === 'balance_data_inconsistent'));
});

test('clean agent with fresh data triggers no rules', () => {
  const rules = runRuleEngine({
    agent: { providers: [{ provider: 'Nagad' }] }, provider: 'Nagad',
    features: cleanFeatures, dataIssues: [], cashIssues: [],
  });
  assert.equal(rules.triggered.length, 0);
  assert.equal(rules.hasCriticalOverride, false);
  assert.equal(rules.recommendationSuppressed, false);
});

test('hard safety rules override operational risk and data-quality rules suppress precision', () => {
  const rules = runRuleEngine({
    agent: { providers: [{ provider: 'bKash' }] }, provider: 'bKash', features,
    dataIssues: ['stale_feed'], cashIssues: [],
  });
  assert.equal(rules.hasCriticalOverride, true);
  assert.equal(rules.recommendationSuppressed, true);
  assert.ok(rules.triggered.some((rule) => rule.id === 'cash_below_critical'));
  assert.ok(rules.triggered.some((rule) => rule.id === 'repeated_near_identical_amounts'));
});
