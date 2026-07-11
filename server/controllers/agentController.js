import Agent from '../models/Agent.js';
import Alert from '../models/Alert.js';
import Transaction from '../models/Transaction.js';
import { forecastAgent } from '../services/forecast.js';
import { providerDataIssues } from '../services/dataQuality.js';

/*
  Role scoping (provider boundaries — brief §5) — ENFORCED on every endpoint,
  including direct-by-id access. An agent requesting another outlet's data by
  URL gets a 404, not the data.
    agent         → own outlet only
    field_officer → agents in own area
     ops           → all areas, optionally restricted to provider scope
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

function allowedProviders(user) {
  if (user.role !== 'ops' || user.providerScope?.includes('all')) return null;
  return (user.providerScope || []).map(canonicalProvider).filter(Boolean);
}

function agentForUser(agent, user) {
  const allowed = allowedProviders(user);
  if (!allowed) return agent;
  const feedEntries = agent.lastFeedAt instanceof Map ? [...agent.lastFeedAt.entries()] : Object.entries(agent.lastFeedAt || {});
  return {
    ...agent,
    providers: (agent.providers || []).filter((provider) => allowed.includes(provider.provider)),
    lastFeedAt: Object.fromEntries(feedEntries.filter(([provider]) => allowed.includes(provider))),
    providerScopeRestricted: true,
  };
}

export function buildManagementOverview(agents, alerts) {
  const rows = new Map();
  const rowFor = (area) => {
    if (!rows.has(area)) rows.set(area, { area, agentCount: 0, openAlerts: 0, criticalAlerts: 0, recurring: new Map() });
    return rows.get(area);
  };

  for (const agent of agents) rowFor(agent.area).agentCount++;
  for (const alert of alerts) {
    const row = rowFor(alert.area);
    if (!['resolved', 'dismissed'].includes(alert.status)) row.openAlerts++;
    if (!['resolved', 'dismissed'].includes(alert.status) && alert.severity === 'critical') row.criticalAlerts++;
    row.recurring.set(alert.subtype, (row.recurring.get(alert.subtype) || 0) + 1);
  }

  const areas = [...rows.values()].map(({ recurring, ...row }) => ({
    ...row,
    readiness: row.criticalAlerts ? 'critical' : row.openAlerts ? 'attention' : 'ready',
  })).sort((left, right) => right.criticalAlerts - left.criticalAlerts || right.openAlerts - left.openAlerts || left.area.localeCompare(right.area));
  const recurring = [...rows.values()].flatMap((row) => [...row.recurring.entries()].map(([subtype, count]) => ({ area: row.area, subtype, count })))
    .filter((item) => item.count > 1)
    .sort((left, right) => right.count - left.count || left.area.localeCompare(right.area));
  return { areas, recurring };
}

export async function listAgents(req, res) {
  const agents = await Agent.find(scopeFilter(req.user)).lean();
  res.json({ agents: agents.map((agent) => agentForUser(agent, req.user)), simulated: true });
}

export async function getManagementOverview(_req, res) {
  const [agents, alerts] = await Promise.all([
    Agent.find({}, 'area').lean(),
    Alert.find({}, 'area subtype severity status').lean(),
  ]);
  res.json({ overview: buildManagementOverview(agents, alerts), simulated: true });
}

async function loadAgentAnalytics(agent, now = new Date()) {
  const since = new Date(now.getTime() - 6 * 60 * 60_000);
  const txns = await Transaction.find({ agentId: agent.agentId, timestamp: { $gte: since, $lte: now } }).lean();
  const txnsByProvider = {};
  for (const p of agent.providers) txnsByProvider[p.provider] = [];
  for (const t of txns) (txnsByProvider[t.provider] ||= []).push(t);
  return { txnsByProvider, ...providerDataIssues(agent, txnsByProvider, now) };
}

export async function getAgent(req, res) {
  const agent = await findScopedAgent(req);
  if (!agent) return res.status(404).json({ error: 'Agent not found' });
  const { issuesByProvider } = await loadAgentAnalytics(agent);
  const visible = agentForUser(agent.toObject(), req.user);
  const allowed = allowedProviders(req.user);
  const visibleIssues = allowed
    ? Object.fromEntries(Object.entries(issuesByProvider).filter(([provider]) => allowed.includes(provider)))
    : issuesByProvider;
  res.json({ agent: visible, issuesByProvider: visibleIssues, staleProviders: Object.keys(visibleIssues), simulated: true });
}

export async function getTransactions(req, res) {
  const agent = await findScopedAgent(req);
  if (!agent) return res.status(404).json({ error: 'Agent not found' });
  const { provider, limit = 50 } = req.query;
  const safeProvider = canonicalProvider(provider);
  if (provider !== undefined && !safeProvider) {
    return res.status(400).json({ error: 'provider must be bKash, Nagad, or Rocket' });
  }
  const allowed = allowedProviders(req.user);
  if (safeProvider && allowed && !allowed.includes(safeProvider)) {
    return res.status(403).json({ error: 'Provider is outside your authorized scope' });
  }
  const q = safeProvider
    ? { agentId: agent.agentId, provider: safeProvider }
    : allowed
      ? { agentId: agent.agentId, provider: { $in: allowed } }
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
  const { txnsByProvider, issuesByProvider, cashIssues, findings } = await loadAgentAnalytics(agent, now);
  const allowed = allowedProviders(req.user);
  const forecasts = forecastAgent(agent, txnsByProvider, now, issuesByProvider, cashIssues)
    .filter((forecast) => !allowed || allowed.includes(forecast.provider));
  const visibleIssues = allowed
    ? Object.fromEntries(Object.entries(issuesByProvider).filter(([provider]) => allowed.includes(provider)))
    : issuesByProvider;
  res.json({
    forecasts,
    issuesByProvider: visibleIssues,
    staleProviders: Object.keys(visibleIssues),
    dataQualityWarnings: findings
      .filter((finding) => !allowed || allowed.includes(finding.provider))
      .map((f) => ({ subtype: f.subtype, ...f.evidence })),
    simulated: true,
  });
}
