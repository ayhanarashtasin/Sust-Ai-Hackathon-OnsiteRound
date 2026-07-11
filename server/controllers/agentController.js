import Agent from '../models/Agent.js';
import Transaction from '../models/Transaction.js';
import { forecastAgent } from '../services/forecast.js';
import { staleProviderSet, checkStaleFeeds } from '../services/dataQuality.js';

/*
  Role scoping (provider boundaries — brief §5):
    agent         → own outlet only
    field_officer → agents in own area
    ops           → all areas, but provider-scoped data views
    risk/management → read across (risk works escalations; management read-only)
*/
function scopeFilter(user) {
  if (user.role === 'agent') return { agentId: user.agentId };
  if (user.role === 'field_officer') return { area: user.area };
  return {};
}

export async function listAgents(req, res) {
  const agents = await Agent.find(scopeFilter(req.user)).lean();
  res.json({ agents, simulated: true });
}

export async function getAgent(req, res) {
  const agent = await Agent.findOne({ agentId: req.params.id }).lean();
  if (!agent) return res.status(404).json({ error: 'Agent not found' });
  const stale = staleProviderSet(await Agent.findOne({ agentId: req.params.id }));
  res.json({ agent, staleProviders: [...stale], simulated: true });
}

export async function getTransactions(req, res) {
  const { provider, limit = 50 } = req.query;
  const q = { agentId: req.params.id };
  if (provider) q.provider = provider;
  const txns = await Transaction.find(q).sort({ timestamp: -1 }).limit(Number(limit)).lean();
  res.json({ transactions: txns, simulated: true });
}

/* Read-side forecast for the panel — cheap pure computation, no alert writes, no OpenAI. */
export async function getForecast(req, res) {
  const agent = await Agent.findOne({ agentId: req.params.id });
  if (!agent) return res.status(404).json({ error: 'Agent not found' });
  const now = new Date();
  const since = new Date(now.getTime() - 6 * 60 * 60_000);
  const txns = await Transaction.find({ agentId: agent.agentId, timestamp: { $gte: since } }).lean();
  const txnsByProvider = {};
  for (const p of agent.providers) txnsByProvider[p.provider] = [];
  for (const t of txns) (txnsByProvider[t.provider] ||= []).push(t);
  const stale = staleProviderSet(agent, now);
  res.json({
    forecasts: forecastAgent(agent, txnsByProvider, now, stale),
    staleProviders: [...stale],
    dataQualityWarnings: checkStaleFeeds(agent, now).map((f) => f.evidence),
    simulated: true,
  });
}
