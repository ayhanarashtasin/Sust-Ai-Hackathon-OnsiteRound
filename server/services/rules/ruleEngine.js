import { evaluateRules } from './ruleDefinitions.js';

const severityOrder = { none: 0, info: 1, warning: 2, critical: 3 };

export function runRuleEngine(input) {
  const all = evaluateRules(input);
  const triggered = all.filter((rule) => rule.triggered);
  const hardSafety = triggered.filter((rule) => rule.category === 'hard_safety');
  const dataQuality = triggered.filter((rule) => rule.category === 'data_quality');
  const anomalyEvidence = triggered.filter((rule) => rule.category === 'anomaly_evidence');
  const severity = triggered.reduce(
    (current, rule) => severityOrder[rule.severity] > severityOrder[current] ? rule.severity : current,
    'info',
  );
  return {
    all,
    triggered,
    hardSafety,
    dataQuality,
    anomalyEvidence,
    hasCriticalOverride: hardSafety.some((rule) => rule.severity === 'critical'),
    recommendationSuppressed: dataQuality.length > 0,
    severity,
  };
}
