function numberEnv(name, fallback, { min = -Infinity, max = Infinity } = {}) {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value >= min && value <= max ? value : fallback;
}

function listEnv(name, fallback) {
  const values = String(process.env[name] || '')
    .split(',')
    .map((value) => Number(value.trim()))
    .filter((value) => Number.isFinite(value) && value > 0);
  return values.length ? [...new Set(values)].sort((a, b) => a - b) : fallback;
}

export const DECISION_CONFIG = Object.freeze({
  featureWindowsMin: listEnv('FEATURE_WINDOWS_MINUTES', [5, 15, 30, 60]),
  dataFreshnessMin: numberEnv('DATA_FRESHNESS_MINUTES', 10, { min: 1, max: 1440 }),
  modelType: process.env.MODEL_TYPE || 'lightgbm',
  modelDir: process.env.MODEL_DIR || '../ml/artifacts',
  mlEnabled: process.env.ML_ENABLED !== 'false',
  liquidityProbability: numberEnv('LIQUIDITY_MODEL_THRESHOLD', 0.65, { min: 0, max: 1 }),
  anomalyProbability: numberEnv('ANOMALY_MODEL_THRESHOLD', 0.7, { min: 0, max: 1 }),
  mediumRisk: numberEnv('MEDIUM_RISK_THRESHOLD', 0.45, { min: 0, max: 1 }),
  highRisk: numberEnv('HIGH_RISK_THRESHOLD', 0.7, { min: 0, max: 1 }),
  criticalRisk: numberEnv('CRITICAL_RISK_THRESHOLD', 0.9, { min: 0, max: 1 }),
  cashBurnRatePerMin: numberEnv('CASH_BURN_RATE_THRESHOLD', 500, { min: 0 }),
  velocityRatio: numberEnv('VELOCITY_RATIO_THRESHOLD', 2.5, { min: 1 }),
  repeatedAmountCount: numberEnv('REPEATED_AMOUNT_COUNT', 5, { min: 2 }),
  smallAccountCount: numberEnv('SMALL_ACCOUNT_COUNT', 3, { min: 1 }),
  highValueAmount: numberEnv('HIGH_VALUE_AMOUNT', 10000, { min: 1 }),
});

export function riskBand(score) {
  if (!Number.isFinite(score)) return 'unknown';
  if (score >= DECISION_CONFIG.criticalRisk) return 'critical';
  if (score >= DECISION_CONFIG.highRisk) return 'high';
  if (score >= DECISION_CONFIG.mediumRisk) return 'medium';
  return 'low';
}
