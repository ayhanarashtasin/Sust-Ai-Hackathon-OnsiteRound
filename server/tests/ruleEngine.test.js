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
