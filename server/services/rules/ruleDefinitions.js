import { DECISION_CONFIG } from '../../config/decisionConfig.js';

const result = (id, category, triggered, severity, reason, values = {}) => ({
  id, category, triggered, severity: triggered ? severity : 'none', reason, values,
});

export function evaluateRules({ agent, provider, features, dataIssues = [], cashIssues = [] }) {
  const providerBalance = (agent.providers || []).find((item) => item.provider === provider) || {};
  const expectedDemand = features.cash_out_amount_60m || 0;
  const providerIssues = dataIssues || [];
  const cashIssueSet = cashIssues || [];
  const rules = [
    result(
      'cash_below_critical', 'hard_safety', features.cash_current <= features.cash_critical,
      'critical', 'Physical cash is below the critical operating threshold.',
      { currentCash: features.cash_current, criticalThreshold: features.cash_critical },
    ),
    result(
      'cash_below_minimum', 'hard_safety', features.cash_current <= features.cash_floor,
      'warning', 'Physical cash is below the minimum operating threshold.',
      { currentCash: features.cash_current, minimumThreshold: features.cash_floor },
    ),
    result(
      'provider_balance_below_demand', 'hard_safety', features.provider_balance <= Math.max(features.provider_floor, expectedDemand),
      'warning', 'Provider electronic balance is below projected near-term demand.',
      { provider, balance: features.provider_balance, projectedDemand: expectedDemand, floor: features.provider_floor },
    ),
    result(
      'cash_burn_rate_high', 'hard_safety', features.cash_burn_rate_30m >= DECISION_CONFIG.cashBurnRatePerMin,
      'warning', 'Shared physical cash is declining faster than the configured safety rate.',
      { burnRate: features.cash_burn_rate_30m, threshold: DECISION_CONFIG.cashBurnRatePerMin },
    ),
    result(
      'velocity_above_baseline', 'anomaly_evidence', features.velocity_ratio >= DECISION_CONFIG.velocityRatio,
      'warning', 'Transaction velocity is significantly above the historical baseline.',
      { velocityRatio: features.velocity_ratio, threshold: DECISION_CONFIG.velocityRatio },
    ),
    result(
      'repeated_near_identical_amounts', 'anomaly_evidence', features.near_identical_count_30m >= DECISION_CONFIG.repeatedAmountCount,
      'warning', 'Several transaction amounts are near-identical within the review window.',
      { count: features.near_identical_count_30m, threshold: DECISION_CONFIG.repeatedAmountCount },
    ),
    result(
      'small_customer_concentration', 'anomaly_evidence', features.max_txns_customer_30m >= DECISION_CONFIG.repeatedAmountCount
        && features.unique_customers_30m <= DECISION_CONFIG.smallAccountCount,
      'warning', 'A small number of synthetic accounts account for repeated activity.',
      { maxTransactionsPerCustomer: features.max_txns_customer_30m, uniqueCustomers: features.unique_customers_30m },
    ),
    result(
      'provider_feed_stale', 'data_quality', providerIssues.includes('stale_feed'),
      'warning', 'Provider feed is older than the configured freshness limit.',
      { provider, feedDelayMinutes: features.feed_delay_min, threshold: DECISION_CONFIG.dataFreshnessMin },
    ),
    result(
      'provider_feed_missing', 'data_quality', providerIssues.includes('missing_feed') || features.feed_missing === 1,
      'warning', 'Provider feed data is missing.',
      { provider },
    ),
    result(
      'balance_data_inconsistent', 'data_quality', providerIssues.includes('balance_mismatch') || cashIssueSet.includes('balance_mismatch')
        || features.balance_mismatch_amount > 0 || features.cash_balance_mismatch_amount > 0,
      'warning', 'Reported balance does not reconcile with the available transaction history.',
      { providerMismatch: features.balance_mismatch_amount, cashMismatch: features.cash_balance_mismatch_amount },
    ),
  ];
  return rules;
}
