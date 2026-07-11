import Alert from '../models/Alert.js';
import User from '../models/User.js';
import { validateAction, hasCaseAuthority, ASSIGNABLE_ROLES } from '../services/caseWorkflow.js';
import { notifyDataUpdate } from '../services/liveUpdates.js';

/*
  Coordination lifecycle (Scenario D). Every transition is recorded in history[]
  — the audit trail. Escalation raises an AUTHORIZED SUPPORT REQUEST;
  it never moves liquidity (brief §14).

  Provider/role boundaries are ENFORCED here, not just displayed:
    agent         → own outlet's alerts only
    field_officer → own area only
    ops           → all areas
    risk          → escalated/resolved cases
    management    → read-only (no mutations anywhere)
  Every read AND write goes through visibilityScope() — direct URL/API access
  to another outlet's case returns 404.
*/
function visibilityScope(user) {
  const scope = {};
  if (user.role === 'agent') scope.agentId = user.agentId;
  if (user.role === 'field_officer') scope.area = user.area;
  if (user.role === 'risk') scope.status = { $in: ['escalated', 'resolved'] };
  if (user.role === 'ops' && !user.providerScope?.includes('all')) {
    const providers = (user.providerScope || []).filter((provider) => ['bKash', 'Nagad', 'Rocket'].includes(provider));
    scope.provider = { $in: [...providers, null] };
  }
  return scope;
}

function historyEntry(req, action, note = '') {
  return { actorUserId: req.user.id, actorName: req.user.name || null, actorRole: req.user.role, action, note };
}

export async function listAlerts(req, res) {
  const { status, provider, area, kind, agentId, riskBand, decisionSource } = req.query;
  const q = {};
  if (status) q.status = { $in: status.split(',') };
  if (provider) q.provider = provider;
  if (area) q.area = area;
  if (kind) q.kind = kind;
  if (agentId) q.agentId = agentId;
  if (riskBand) q.riskBand = riskBand;
  if (decisionSource) q.decisionSource = decisionSource;
  Object.assign(q, visibilityScope(req.user)); // boundary wins over query params
  const alerts = await Alert.find(q).sort({ severity: -1, updatedAt: -1 }).limit(100).lean();
  res.json({ alerts, simulated: true });
}

export async function getAlert(req, res) {
  const alert = await Alert.findOne({ alertId: req.params.id, ...visibilityScope(req.user) }).lean();
  if (!alert) return res.status(404).json({ error: 'Alert not found' });
  res.json({ alert, simulated: true });
}

/* Case-working users a case can be assigned to (drives the assignment UI). */
export async function listAssignableUsers(req, res) {
  const users = await User.find({ role: { $in: ASSIGNABLE_ROLES } })
    .select('name role area')
    .lean();
  res.json({ users: users.map((u) => ({ id: u._id.toString(), name: u.name, role: u.role, area: u.area })), simulated: true });
}

/*
  DEMO RESET utility — wipes alerts so a scenario can be replayed from a clean
  slate (e.g. between judge runs). Not part of the coordination workflow:
  production systems would archive alerts, never bulk-delete (auditability).
  Optional ?agentId= scopes the wipe to one outlet.
*/
export async function clearAlerts(req, res) {
  const q = {};
  if (req.query.agentId) q.agentId = req.query.agentId;
  Object.assign(q, visibilityScope(req.user));
  const { deletedCount } = await Alert.deleteMany(q);
  notifyDataUpdate();
  res.json({ deleted: true, deletedCount, simulated: true });
}

/*
  Shared transition executor: scope check (404) → workflow validation
  (403 role / 409 illegal state / 400 bad target) → write + audit entry.
*/
async function transition(req, res, { action, status, note, extra = {}, targetRole = null }) {
  const alert = await Alert.findOne({ alertId: req.params.id, ...visibilityScope(req.user) });
  if (!alert) return res.status(404).json({ error: 'Alert not found' });

  const verdict = validateAction({ action, role: req.user.role, currentStatus: alert.status, targetRole });
  if (!verdict.ok) return res.status(verdict.code).json({ error: verdict.error });
  if (!hasCaseAuthority({ action, user: req.user, alert })) {
    return res.status(403).json({ error: 'Case is routed to another role or owner' });
  }

  Object.assign(alert, extra);
  if (status) alert.status = status;
  if (status === 'resolved') alert.resolvedAt = new Date();
  alert.history.push(historyEntry(req, action, note || req.body?.note || ''));
  await alert.save();
  notifyDataUpdate();
  res.json({ alert, simulated: true });
}

export const acknowledge = (req, res) =>
  transition(req, res, {
    action: 'acknowledge',
    status: 'acknowledged',
    // An outlet acknowledgement confirms receipt without taking ownership from the routed team.
    extra: req.user.role === 'agent'
      ? { acknowledgedAt: new Date() }
      : { ownerUserId: req.user.id, ownerName: req.user.name || null, acknowledgedAt: new Date() },
  });

/* Assignment targets must be real, case-working users — no arbitrary IDs. */
export async function assign(req, res) {
  const targetId = req.body?.userId;
  if (!targetId) return res.status(400).json({ error: 'userId required' });
  let target;
  try {
    target = await User.findById(targetId).lean();
  } catch {
    target = null; // malformed ObjectId
  }
  if (!target || !ASSIGNABLE_ROLES.includes(target.role)) {
    return res.status(400).json({ error: `Assignee must be an existing user with role: ${ASSIGNABLE_ROLES.join(', ')}` });
  }
  const alert = await Alert.findOne({ alertId: req.params.id, ...visibilityScope(req.user) }).lean();
  if (!alert) return res.status(404).json({ error: 'Alert not found' });
  if (!hasCaseAuthority({ action: 'assign', user: req.user, alert })) {
    return res.status(403).json({ error: 'Case is routed to another role or owner' });
  }
  if (target.role !== alert.routedToRole) {
    return res.status(400).json({ error: `Assignee must have the routed role: ${alert.routedToRole}` });
  }
  if (target.role === 'field_officer' && target.area && target.area !== alert.area) {
    return res.status(400).json({ error: 'Assignee is outside the alert area' });
  }
  if (target.role === 'ops' && alert.provider && !target.providerScope?.includes('all') && !target.providerScope?.includes(alert.provider)) {
    return res.status(400).json({ error: 'Assignee is outside the alert provider scope' });
  }
  return transition(req, res, {
    action: 'assign',
    status: 'in_progress',
    note: `assigned to ${target.name} (${target.role})`,
    extra: { ownerUserId: target._id.toString(), ownerName: target.name },
  });
}

export const escalate = (req, res) => {
  const toRole = req.body?.toRole || 'risk';
  return transition(req, res, {
    action: 'escalate',
    status: 'escalated',
    note: req.body?.note || `escalated to ${toRole} — authorized support request`,
    extra: { routedToRole: toRole, ownerUserId: null, ownerName: null, escalatedAt: new Date() },
    targetRole: toRole,
  });
};

export const resolve = (req, res) => {
  const note = String(req.body?.note || 'Resolved after human review').trim();
  return transition(req, res, {
    action: 'resolve', status: 'resolved', note, extra: { resolutionNote: note },
  });
};

export const addNote = (req, res) =>
  transition(req, res, { action: 'note', note: req.body?.note || '' });

/*
  Dismiss = ARCHIVE with an audit entry. It never deletes the alert, never
  touches transactions or balances (the old behavior reset the whole outlet —
  that destroyed the audit trail). The sim's re-alert cooldown keeps the same
  condition from instantly re-opening a fresh case.
*/
export const dismiss = (req, res) =>
  transition(req, res, { action: 'dismiss', status: 'dismissed', note: req.body?.note || 'dismissed after review' });
