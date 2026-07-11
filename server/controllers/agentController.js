import Agent from '../models/Agent.js';
import Transaction from '../models/Transaction.js';
import { forecastAgent } from '../services/forecast.js';
import { providerDataIssues } from '../services/dataQuality.js';

/*
  Role scoping (provider boundaries — brief §5) — ENFORCED on every endpoint,
  including direct-by-id access. An agent requesting another outlet's data by
  URL gets a 404, not the data.
    agent         → own outlet only
    field_officer → agents in own area
    ops           → all areas
    risk/management → read across (risk works escalations; management read-only)
*/
function scopeFilter(user) {
  if (user.role === 'agent') return { agentId: user.agentId };
  if (user.role === 'field_officer') return { area: user.area };
  return {};
}

async function findScopedAgent(req) {
  // $and so the requested id and the role scope BOTH apply — a plain object
  // spread would let one agentId key silently overwrite the other.
  return Agent.findOne({ $and: [{ agentId: String(req.params.id) }, scopeFilter(req.user)] });
}

function canonicalProvider(value) {
  if (value === 'bKash') return 'bKash';
  if (value === 'Nagad') return 'Nagad';
  if (value === 'Rocket') return 'Rocket';
  return null;
}

export async function listAgents(req, res) {
  const agents = await Agent.find(scopeFilter(req.user)).lean();
  res.json({ agents, simulated: true });
}

async function loadAgentAnalytics(agent, now = new Date()) {
  const since = new Date(now.getTime() - 6 * 60 * 60_000);
  const txns = await Transaction.find({ agentId: agent.agentId, timestamp: { $gte: since } }).lean();
  const txnsByProvider = {};
  for (const p of agent.providers) txnsByProvider[p.provider] = [];
  for (const t of txns) (txnsByProvider[t.provider] ||= []).push(t);
  return { txnsByProvider, ...providerDataIssues(agent, txnsByProvider, now) };
}

export async function getAgent(req, res) {
  const agent = await findScopedAgent(req);
  if (!agent) return res.status(404).json({ error: 'Agent not found' });
  const { issuesByProvider } = await loadAgentAnalytics(agent);
  res.json({ agent: agent.toObject(), issuesByProvider, staleProviders: Object.keys(issuesByProvider), simulated: true });
}

export async function getTransactions(req, res) {
  const agent = await findScopedAgent(req);
  if (!agent) return res.status(404).json({ error: 'Agent not found' });
  const { provider, limit = 50 } = req.query;
  const safeProvider = canonicalProvider(provider);
  if (provider !== undefined && !safeProvider) {
    return res.status(400).json({ error: 'provider must be bKash, Nagad, or Rocket' });
  }
  const q = safeProvider
    ? { agentId: agent.agentId, provider: safeProvider }
    : { agentId: agent.agentId };
  const txns = await Transaction.find(q).sort({ timestamp: -1 }).limit(Math.min(200, Number(limit) || 50)).lean();
  res.json({ transactions: txns, simulated: true });
}

/*
  Read-side forecast for the panel — cheap pure functions recomputed on read
  (documented in docs/architecture.md). No alert writes, no NL generation, no
  OpenAI in this path; those happen only on the sim tick (compute-on-write).
*/
export async function getForecast(req, res) {
  const agent = await findScopedAgent(req);
  if (!agent) return res.status(404).json({ error: 'Agent not found' });
  const now = new Date();
  const { txnsByProvider, issuesByProvider, findings } = await loadAgentAnalytics(agent, now);
  res.json({
    forecasts: forecastAgent(agent, txnsByProvider, now, issuesByProvider),
    issuesByProvider,
    staleProviders: Object.keys(issuesByProvider),
    dataQualityWarnings: findings.map((f) => ({ subtype: f.subtype, ...f.evidence })),
    simulated: true,
  });
}
