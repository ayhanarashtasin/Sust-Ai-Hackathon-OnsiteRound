import Agent from '../models/Agent.js';
import Transaction from '../models/Transaction.js';
import { evaluateDecisionSupport } from '../services/ml/decisionSupport.js';

function scopeFilter(user) {
  if (user.role === 'agent') return { agentId: user.agentId };
  if (user.role === 'field_officer') return { area: user.area };
  return {};
}

function allowedProviders(user) {
  if (user.role !== 'ops' || user.providerScope?.includes('all')) return null;
  return (user.providerScope || []).filter((provider) => ['bKash', 'Nagad', 'Rocket'].includes(provider));
}

async function scopedAgent(req) {
  return Agent.findOne({ $and: [{ agentId: String(req.params.id) }, scopeFilter(req.user)] });
}

async function evaluate(req) {
  const agent = await scopedAgent(req);
  if (!agent) return { error: 'Agent not found', code: 404 };
  const now = new Date();
  const since = new Date(now.getTime() - 7 * 24 * 60 * 60_000);
  const transactions = await Transaction.find({ agentId: agent.agentId, timestamp: { $gte: since, $lte: now } }).lean();
  const result = await evaluateDecisionSupport({ agent, transactions, now });
  const allowed = allowedProviders(req.user);
  if (allowed) {
    result.providerDecisions = result.providerDecisions.filter((decision) => allowed.includes(decision.provider));
    result.forecasts = result.forecasts.filter((forecast) => forecast.resource === 'cash' || allowed.includes(forecast.provider));
    result.dataQuality.issuesByProvider = Object.fromEntries(
      Object.entries(result.dataQuality.issuesByProvider).filter(([provider]) => allowed.includes(provider)),
    );
    result.dataQuality.findings = result.dataQuality.findings.filter((finding) => finding.provider == null || allowed.includes(finding.provider));
    result.mainPressure = result.providerDecisions
      .flatMap((decision) => [decision.liquidity, decision.anomaly])
      .sort((left, right) => right.riskScore - left.riskScore)[0] || null;
  }
  return { agent, result };
}

export async function getDecisionSupport(req, res) {
  const outcome = await evaluate(req);
  if (outcome.error) return res.status(outcome.code).json({ error: outcome.error });
  res.json({ decisionSupport: outcome.result, simulated: true });
}

export async function getAnomalies(req, res) {
  const outcome = await evaluate(req);
  if (outcome.error) return res.status(outcome.code).json({ error: outcome.error });
  const anomalies = outcome.result.providerDecisions.map(({ provider, anomaly }) => ({ provider, ...anomaly }));
  res.json({ anomalies, generatedAt: outcome.result.generatedAt, simulated: true });
}
