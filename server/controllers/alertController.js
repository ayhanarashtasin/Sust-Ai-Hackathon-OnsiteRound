import Alert from '../models/Alert.js';
import { resetSimAgent } from '../services/simEngine.js';

/*
  Coordination lifecycle (Scenario D). Every transition is recorded in history[]
  — the audit trail. Escalation raises an AUTHORIZED SUPPORT REQUEST;
  it never moves liquidity (brief §14).
*/
function historyEntry(req, action, note = '') {
  return { actorUserId: req.user.id, actorRole: req.user.role, action, note };
}

export async function listAlerts(req, res) {
  const { status, provider, area, kind, agentId } = req.query;
  const q = {};
  if (status) q.status = { $in: status.split(',') };
  if (provider) q.provider = provider;
  if (area) q.area = area;
  if (kind) q.kind = kind;
  if (agentId) q.agentId = agentId;
  if (req.user.role === 'agent') q.agentId = req.user.agentId;
  if (req.user.role === 'field_officer') q.area = req.user.area;
  if (req.user.role === 'risk') q.status = q.status || { $in: ['escalated', 'resolved'] };
  const alerts = await Alert.find(q).sort({ severity: -1, updatedAt: -1 }).limit(100).lean();
  res.json({ alerts, simulated: true });
}

export async function getAlert(req, res) {
  const alert = await Alert.findOne({ alertId: req.params.id }).lean();
  if (!alert) return res.status(404).json({ error: 'Alert not found' });
  res.json({ alert, simulated: true });
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
  if (req.user.role === 'agent') q.agentId = req.user.agentId;
  if (req.user.role === 'field_officer') q.area = req.user.area;
  if (req.user.role === 'risk') q.status = { $in: ['escalated', 'resolved'] };
  const { deletedCount } = await Alert.deleteMany(q);
  res.json({ deleted: true, deletedCount, simulated: true });
}

export async function deleteAlert(req, res) {
  const q = { alertId: req.params.id };
  if (req.user.role === 'agent') q.agentId = req.user.agentId;
  if (req.user.role === 'field_officer') q.area = req.user.area;
  if (req.user.role === 'risk') q.status = { $in: ['escalated', 'resolved'] };
  const alert = await Alert.findOne(q);
  if (!alert) return res.status(404).json({ error: 'Alert not found' });
  const reset = await resetSimAgent(alert.agentId);
  if (reset.error) return res.status(500).json({ error: reset.error });
  res.json({ deleted: true, alertId: alert.alertId, reset, simulated: true });
}

async function transition(req, res, { action, status, note, extra = {} }) {
  const alert = await Alert.findOne({ alertId: req.params.id });
  if (!alert) return res.status(404).json({ error: 'Alert not found' });
  Object.assign(alert, extra);
  if (status) alert.status = status;
  if (status === 'resolved') alert.resolvedAt = new Date();
  alert.history.push(historyEntry(req, action, note || req.body?.note || ''));
  await alert.save();
  res.json({ alert, simulated: true });
}

export const acknowledge = (req, res) =>
  transition(req, res, { action: 'acknowledged', status: 'acknowledged', extra: { ownerUserId: req.user.id } });

export const assign = (req, res) =>
  transition(req, res, { action: 'assigned', status: 'in_progress', note: `assigned to ${req.body?.userId || req.user.id}`, extra: { ownerUserId: req.body?.userId || req.user.id } });

export const escalate = (req, res) =>
  transition(req, res, { action: 'escalated', status: 'escalated', note: req.body?.note || `escalated to ${req.body?.toRole || 'risk'} — authorized support request`, extra: { routedToRole: req.body?.toRole || 'risk' } });

export const resolve = (req, res) =>
  transition(req, res, { action: 'resolved', status: 'resolved' });

export const addNote = (req, res) =>
  transition(req, res, { action: 'note', note: req.body?.note || '' });
