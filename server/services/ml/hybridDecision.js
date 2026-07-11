import { DECISION_CONFIG, riskBand } from '../../config/decisionConfig.js';

function clamp(value, min = 0.1, max = 0.99) {
  return Math.max(min, Math.min(max, value));
}

function dataConfidence(features, rules) {
  let confidence = 1 - Math.min(0.5, features.missing_feature_pct * 0.5);
  if (rules.dataQuality.some((rule) => rule.id === 'provider_feed_missing')) confidence -= 0.45;
  if (rules.dataQuality.some((rule) => rule.id === 'provider_feed_stale')) confidence -= 0.3;
  if (rules.dataQuality.some((rule) => rule.id === 'balance_data_inconsistent')) confidence -= 0.2;
  return clamp(confidence, 0.1, 1);
}

function ruleRisk(rules, type) {
  const evidence = type === 'liquidity' ? rules.hardSafety : rules.anomalyEvidence;
  if (rules.hasCriticalOverride && type === 'liquidity') return 0.98;
  if (!evidence.length) return 0.1;
  return clamp(0.35 + evidence.length * 0.18, 0.1, 0.9);
}

function confidence({ model, rules, features }) {
  const data = dataConfidence(features, rules);
  if (!model.available) return { score: clamp(data * 0.65), data, source: 'rules_only', fallbackReason: model.fallbackReason };
  const probabilityStrength = Math.abs(model.probability - 0.5) * 2;
  const modelQuality = Number.isFinite(model.validationPrAuc) ? model.validationPrAuc : 0.65;
  const agreement = rules.triggered.length ? 1 : 0.65;
  return {
    score: clamp((0.35 + probabilityStrength * 0.25 + modelQuality * 0.25 + agreement * 0.15) * data),
    data,
    source: rules.triggered.length ? 'hybrid' : 'model',
    fallbackReason: null,
  };
}

function decide(type, model, rules, features) {
  const threshold = type === 'liquidity' ? DECISION_CONFIG.liquidityProbability : DECISION_CONFIG.anomalyProbability;
  const ruleScore = ruleRisk(rules, type);
  const hardOverride = type === 'liquidity' && rules.hasCriticalOverride;
  const riskScore = hardOverride ? 0.98 : model.available ? Math.max(model.probability, ruleScore) : ruleScore;
  const confidenceResult = confidence({ model, rules, features });
  const modelHigh = model.available && model.probability >= threshold;
  const ruleTriggered = type === 'liquidity' ? rules.hardSafety.length > 0 : rules.anomalyEvidence.length > 0;
  const alert = hardOverride || modelHigh || ruleTriggered;
  const mode = hardOverride ? 'critical_override'
    : modelHigh && ruleTriggered ? 'model_rule_agreement'
      : modelHigh ? 'model_only'
        : ruleTriggered ? 'rule_only' : 'none';
  return {
    task: type === 'liquidity' ? 'liquidity_shortage_60m' : 'unusual_activity_review',
    riskScore: clamp(riskScore),
    riskBand: riskBand(riskScore),
    confidenceScore: confidenceResult.score,
    dataConfidence: confidenceResult.data,
    decisionSource: confidenceResult.source,
    fallbackReason: confidenceResult.fallbackReason,
    model: model.available ? {
      type: model.modelType, version: model.modelVersion, probability: model.probability, threshold: model.threshold,
    } : null,
    mode,
    alert,
    preciseHorizonAllowed: confidenceResult.data >= 0.7 && rules.dataQuality.length === 0,
  };
}

export function combineDecisions({ liquidityModel, anomalyModel, rules, features }) {
  return {
    liquidity: decide('liquidity', liquidityModel, rules, features),
    anomaly: decide('anomaly', anomalyModel, rules, features),
  };
}
