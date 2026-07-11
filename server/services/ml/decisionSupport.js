import { randomUUID } from 'node:crypto';
import Prediction from '../../models/Prediction.js';
import { providerDataIssues } from '../dataQuality.js';
import { forecastAgent } from '../forecast.js';
import { buildFeatureSnapshot } from './featurePipeline.js';
import { predictModel } from './modelRuntime.js';
import { runRuleEngine } from '../rules/ruleEngine.js';
import { combineDecisions } from './hybridDecision.js';
import { dataFreshness, readableEvidence } from './evidenceMapper.js';

function groupTransactions(agent, transactions) {
  const grouped = Object.fromEntries((agent.providers || []).map((provider) => [provider.provider, []]));
  for (const transaction of transactions) (grouped[transaction.provider] ||= []).push(transaction);
  return grouped;
}

function mismatchAmount(findings, provider, resource) {
  return findings
    .filter((finding) => finding.subtype === 'balance_mismatch' && finding.provider === provider && (!resource || finding.evidence?.resource === resource))
    .reduce((maximum, finding) => Math.max(maximum, Number(finding.evidence?.deltaAbs) || 0), 0);
}

function safeNextStep(decision, rules, provider) {
  if (rules.dataQuality.length) return `Verify the ${provider} feed and balance before relying on a precise operational recommendation.`;
  if (decision.task === 'unusual_activity_review') return 'Review the unusual transaction evidence with the responsible operations or risk team before taking any major action.';
  return 'Assigned field or provider operations staff should contact the outlet and review approved liquidity-support options.';
}

function annotate(decision, rules, features, provider, forecast) {
  return {
    ...decision,
    provider,
    forecast,
    triggeredRules: rules.triggered,
    evidence: readableEvidence(features, provider),
    dataFreshness: dataFreshness(features, rules),
    safeNextStep: safeNextStep(decision, rules, provider),
  };
}

async function persist(agentId, provider, features, decision) {
  if (!decision.alert) return;
  const taskDecisions = [decision.liquidity, decision.anomaly];
  for (const item of taskDecisions) {
    if (!item.alert) continue;
    await Prediction.create({
      predictionId: `PRD-${randomUUID()}`,
      agentId,
      provider,
      task: item.task,
      horizonMin: 60,
      riskScore: item.riskScore,
      confidenceScore: item.confidenceScore,
      dataConfidence: item.dataConfidence,
      decisionSource: item.decisionSource,
      modelType: item.model?.type || null,
      modelVersion: item.model?.version || null,
      featureSchemaVersion: features.schemaVersion,
      featureSnapshot: features.values,
      triggeredRules: item.triggeredRules,
      evidence: item.evidence,
      dataFreshness: item.dataFreshness,
      fallbackReason: item.fallbackReason,
      simulated: true,
    });
  }
}

export async function evaluateDecisionSupport({ agent, transactions, now = new Date(), context = {}, persistPredictions = false }) {
  const txnsByProvider = groupTransactions(agent, transactions);
  const quality = providerDataIssues(agent, txnsByProvider, now);
  const forecasts = forecastAgent(agent, txnsByProvider, now, quality.issuesByProvider, quality.cashIssues);
  const providerDecisions = [];
  for (const providerBalance of agent.providers || []) {
    const provider = providerBalance.provider;
    const features = buildFeatureSnapshot({
      agent,
      provider,
      transactions,
      asOf: now,
      context,
      dataQuality: {
        balanceMismatchAmount: mismatchAmount(quality.findings, provider),
        cashBalanceMismatchAmount: mismatchAmount(quality.findings, null, 'cash'),
      },
    });
    const rules = runRuleEngine({
      agent,
      provider,
      features: features.values,
      dataIssues: quality.issuesByProvider[provider] || [],
      cashIssues: quality.cashIssues,
    });
    const [liquidityModel, anomalyModel] = await Promise.all([
      predictModel('liquidity_shortage_60m', features),
      predictModel('unusual_activity_review', features),
    ]);
    const combined = combineDecisions({ liquidityModel, anomalyModel, rules, features: features.values });
    const providerForecast = forecasts.find((forecast) => forecast.resource === 'emoney' && forecast.provider === provider) || null;
    const liquidity = annotate(combined.liquidity, rules, features.values, provider, providerForecast);
    const anomaly = annotate(combined.anomaly, rules, features.values, provider, providerForecast);
    const entry = { provider, features, rules, liquidity, anomaly };
    providerDecisions.push(entry);
    if (persistPredictions) await persist(agent.agentId, provider, features, { alert: liquidity.alert || anomaly.alert, liquidity, anomaly });
  }
  const all = providerDecisions.flatMap((entry) => [entry.liquidity, entry.anomaly]);
  const priority = { critical: 4, high: 3, medium: 2, low: 1, unknown: 0 };
  const mainPressure = [...all].sort((left, right) => priority[right.riskBand] - priority[left.riskBand] || right.riskScore - left.riskScore)[0] || null;
  return {
    generatedAt: now,
    agentId: agent.agentId,
    providerDecisions,
    forecasts,
    dataQuality: quality,
    mainPressure,
    modelAvailable: all.some((decision) => decision.model != null),
    simulated: true,
  };
}
