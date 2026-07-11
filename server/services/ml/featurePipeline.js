import { DECISION_CONFIG } from '../../config/decisionConfig.js';
import { signedDelta } from '../signedDelta.js';

export const FEATURE_SCHEMA_VERSION = '1.0.0';
const PROVIDERS = ['bKash', 'Nagad', 'Rocket'];
const WINDOW_METRICS = [
  'txn_count', 'cash_in_amount', 'cash_out_amount', 'net_cash_flow',
  'provider_emoney_flow', 'avg_amount', 'max_amount', 'amount_std',
  'unique_customers', 'max_txns_customer', 'failed_ratio', 'high_value_ratio',
  'repeated_exact_count', 'near_identical_count',
];

const BASE_FEATURES = [
  'cash_current', 'cash_opening', 'cash_floor', 'cash_critical',
  'provider_balance', 'provider_opening', 'provider_floor', 'provider_critical',
  'provider_bkash', 'provider_nagad', 'provider_rocket',
  'hour_sin', 'hour_cos', 'day_sin', 'day_cos', 'is_weekend',
  'is_salary_day', 'is_eid_event', 'is_local_event', 'is_unusual_hour',
  'feed_delay_min', 'feed_missing', 'balance_mismatch_amount',
  'cash_balance_mismatch_amount', 'missing_feature_pct', 'previous_shortage_count',
  'historical_count_same_hour', 'historical_amount_same_hour',
  'baseline_count_deviation', 'demand_acceleration', 'provider_share_30m',
  'velocity_ratio', 'cash_burn_rate_30m', 'emoney_burn_rate_30m',
];

export const FEATURE_COLUMNS = Object.freeze([
  ...BASE_FEATURES,
  ...DECISION_CONFIG.featureWindowsMin.flatMap((window) =>
    WINDOW_METRICS.map((metric) => `${metric}_${window}m`)),
]);

function finite(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function dateOf(value) {
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function std(values, mean) {
  if (values.length < 2) return 0;
  return Math.sqrt(values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / values.length);
}

function maxGroupCount(values) {
  const counts = new Map();
  for (const value of values) counts.set(value, (counts.get(value) || 0) + 1);
  return Math.max(0, ...counts.values());
}

function nearIdenticalCount(amounts, tolerance = 200) {
  if (!amounts.length) return 0;
  const sorted = [...amounts].sort((a, b) => a - b);
  let best = 1;
  let left = 0;
  for (let right = 0; right < sorted.length; right++) {
    while (sorted[right] - sorted[left] > tolerance) left++;
    best = Math.max(best, right - left + 1);
  }
  return best;
}

function windowStats(txns, provider, asOf, windowMin) {
  const start = new Date(asOf.getTime() - windowMin * 60_000);
  const rows = txns.filter((txn) => {
    const timestamp = dateOf(txn.timestamp);
    return timestamp && timestamp > start && timestamp <= asOf && txn.provider === provider;
  });
  const successful = rows.filter((txn) => txn.status === 'success');
  const amounts = successful.map((txn) => finite(txn.amount)).filter((amount) => amount > 0);
  const mean = amounts.length ? amounts.reduce((sum, amount) => sum + amount, 0) / amounts.length : 0;
  const customerCounts = new Map();
  for (const txn of successful) {
    customerCounts.set(txn.customerHash, (customerCounts.get(txn.customerHash) || 0) + 1);
  }
  const cashIn = successful.filter((txn) => txn.type === 'cash_in').reduce((sum, txn) => sum + txn.amount, 0);
  const cashOut = successful.filter((txn) => txn.type === 'cash_out').reduce((sum, txn) => sum + txn.amount, 0);
  const netCash = successful.reduce((sum, txn) => sum + signedDelta(txn).cash, 0);
  const emoneyFlow = successful.reduce((sum, txn) => sum + signedDelta(txn).emoney, 0);
  return {
    rows,
    values: {
      [`txn_count_${windowMin}m`]: rows.length,
      [`cash_in_amount_${windowMin}m`]: cashIn,
      [`cash_out_amount_${windowMin}m`]: cashOut,
      [`net_cash_flow_${windowMin}m`]: netCash,
      [`provider_emoney_flow_${windowMin}m`]: emoneyFlow,
      [`avg_amount_${windowMin}m`]: mean,
      [`max_amount_${windowMin}m`]: amounts.length ? Math.max(...amounts) : 0,
      [`amount_std_${windowMin}m`]: std(amounts, mean),
      [`unique_customers_${windowMin}m`]: customerCounts.size,
      [`max_txns_customer_${windowMin}m`]: Math.max(0, ...customerCounts.values()),
      [`failed_ratio_${windowMin}m`]: rows.length ? rows.filter((txn) => txn.status === 'failed').length / rows.length : 0,
      [`high_value_ratio_${windowMin}m`]: amounts.length ? amounts.filter((amount) => amount >= DECISION_CONFIG.highValueAmount).length / amounts.length : 0,
      [`repeated_exact_count_${windowMin}m`]: maxGroupCount(amounts.map((amount) => Math.round(amount))),
      [`near_identical_count_${windowMin}m`]: nearIdenticalCount(amounts),
    },
  };
}

function sameHourBaseline(providerTxns, asOf) {
  const cutoff = new Date(asOf.getTime() - 60 * 60_000);
  const dates = new Map();
  for (const txn of providerTxns) {
    const timestamp = dateOf(txn.timestamp);
    if (!timestamp || timestamp > cutoff || timestamp.getUTCHours() !== asOf.getUTCHours()) continue;
    const key = timestamp.toISOString().slice(0, 10);
    const entry = dates.get(key) || { count: 0, amount: 0 };
    entry.count++;
    entry.amount += finite(txn.amount);
    dates.set(key, entry);
  }
  if (!dates.size) return { count: 0, amount: 0 };
  const values = [...dates.values()];
  return {
    count: values.reduce((sum, value) => sum + value.count, 0) / values.length,
    amount: values.reduce((sum, value) => sum + value.amount, 0) / values.length,
  };
}

function feedTimestamp(agent, provider) {
  return agent.lastFeedAt?.get ? agent.lastFeedAt.get(provider) : agent.lastFeedAt?.[provider];
}

export function buildFeatureSnapshot({
  agent,
  provider,
  transactions = [],
  asOf = new Date(),
  context = {},
  dataQuality = {},
}) {
  if (!PROVIDERS.includes(provider)) throw new Error(`Unsupported provider: ${provider}`);
  const predictionTime = dateOf(asOf);
  if (!predictionTime) throw new Error('asOf must be a valid date');
  const historical = transactions.filter((txn) => {
    const timestamp = dateOf(txn.timestamp);
    return timestamp && timestamp <= predictionTime;
  });
  const providerTxns = historical.filter((txn) => txn.provider === provider);
  const balance = (agent.providers || []).find((item) => item.provider === provider) || {};
  const windows = Object.fromEntries(DECISION_CONFIG.featureWindowsMin.map((window) => [window, windowStats(historical, provider, predictionTime, window)]));
  const baseline = sameHourBaseline(providerTxns, predictionTime);
  const hour = predictionTime.getUTCHours();
  const day = predictionTime.getUTCDay();
  const feedAt = dateOf(feedTimestamp(agent, provider));
  const feedDelay = feedAt ? Math.max(0, (predictionTime - feedAt) / 60_000) : DECISION_CONFIG.dataFreshnessMin * 10;
  const count5 = windows[5]?.values.txn_count_5m || 0;
  const count15 = windows[15]?.values.txn_count_15m || 0;
  const count30 = windows[30]?.values.txn_count_30m || 0;
  const count60 = windows[60]?.values.txn_count_60m || 0;
  const cashOut30 = windows[30]?.values.cash_out_amount_30m || 0;
  const allCashOut30 = historical
    .filter((txn) => {
      const timestamp = dateOf(txn.timestamp);
      return timestamp > new Date(predictionTime.getTime() - 30 * 60_000) && txn.type === 'cash_out' && txn.status === 'success';
    })
    .reduce((sum, txn) => sum + finite(txn.amount), 0);
  const missingRaw = [agent.cashBalance, balance.emoneyBalance, feedAt].filter((value) => value == null).length;
  const values = {
    cash_current: finite(agent.cashBalance),
    cash_opening: finite(agent.cashOpeningBalance),
    cash_floor: finite(agent.cashFloorThreshold),
    cash_critical: finite(agent.cashCriticalThreshold, finite(agent.cashFloorThreshold) / 2),
    provider_balance: finite(balance.emoneyBalance),
    provider_opening: finite(balance.openingBalance),
    provider_floor: finite(balance.floorThreshold),
    provider_critical: finite(balance.criticalThreshold, finite(balance.floorThreshold) / 2),
    provider_bkash: provider === 'bKash' ? 1 : 0,
    provider_nagad: provider === 'Nagad' ? 1 : 0,
    provider_rocket: provider === 'Rocket' ? 1 : 0,
    hour_sin: Math.sin((2 * Math.PI * hour) / 24),
    hour_cos: Math.cos((2 * Math.PI * hour) / 24),
    day_sin: Math.sin((2 * Math.PI * day) / 7),
    day_cos: Math.cos((2 * Math.PI * day) / 7),
    is_weekend: day === 5 || day === 6 ? 1 : 0,
    is_salary_day: context.salaryDay ? 1 : 0,
    is_eid_event: context.eid ? 1 : 0,
    is_local_event: context.localEvent ? 1 : 0,
    is_unusual_hour: hour < 6 || hour > 22 ? 1 : 0,
    feed_delay_min: feedDelay,
    feed_missing: feedAt ? 0 : 1,
    balance_mismatch_amount: finite(dataQuality.balanceMismatchAmount),
    cash_balance_mismatch_amount: finite(dataQuality.cashBalanceMismatchAmount),
    missing_feature_pct: missingRaw / 3,
    previous_shortage_count: finite(context.previousShortageCount),
    historical_count_same_hour: baseline.count,
    historical_amount_same_hour: baseline.amount,
    baseline_count_deviation: baseline.count > 0 ? (count60 - baseline.count) / baseline.count : 0,
    demand_acceleration: count60 > 0 ? count15 / Math.max(1, count60 / 4) : 0,
    provider_share_30m: allCashOut30 > 0 ? cashOut30 / allCashOut30 : 0,
    velocity_ratio: baseline.count > 0 ? count5 / Math.max(0.25, baseline.count / 12) : count5,
    cash_burn_rate_30m: Math.max(0, -(windows[30]?.values.net_cash_flow_30m || 0) / 30),
    emoney_burn_rate_30m: Math.max(0, -(windows[30]?.values.provider_emoney_flow_30m || 0) / 30),
  };
  for (const window of DECISION_CONFIG.featureWindowsMin) Object.assign(values, windows[window].values);
  const ordered = Object.fromEntries(FEATURE_COLUMNS.map((column) => [column, finite(values[column])]));
  return {
    schemaVersion: FEATURE_SCHEMA_VERSION,
    asOf: predictionTime,
    agentId: agent.agentId,
    provider,
    values: ordered,
    vector: FEATURE_COLUMNS.map((column) => ordered[column]),
    metadata: { feedDelayMin: feedDelay, baselineCount: baseline.count },
  };
}
