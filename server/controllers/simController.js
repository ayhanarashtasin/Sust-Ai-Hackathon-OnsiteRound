import Agent from '../models/Agent.js';
import { startSim, stopSim, stepSim, resetSimAgent, simStatus } from '../services/simEngine.js';

/*
  Demo streamer control — "Eid rush" button lands here. SIMULATED transactions only.
  Sim control follows the same boundaries as everything else: an agent may only
  drive their own outlet, a field officer only outlets in their area, and
  management (read-only) may not drive the sim at all (route-gated).
*/
async function canControlAgent(user, agentId) {
  const safeAgentId = String(agentId);
  if (user.role === 'agent') return user.agentId === safeAgentId;
  if (user.role === 'field_officer') return Boolean(await Agent.exists({ agentId: safeAgentId, area: user.area }));
  return true; // ops / risk
}

export async function start(req, res) {
  const { agentId, scenario = 'B', speed = 1 } = req.body || {};
  if (!agentId) return res.status(400).json({ error: 'agentId required' });
  if (!['A', 'B', 'C', 'D'].includes(scenario)) return res.status(400).json({ error: 'scenario must be A|B|C|D' });
  if (!(await canControlAgent(req.user, agentId))) return res.status(403).json({ error: 'Insufficient role' });
  res.json({ sim: startSim({ agentId, scenario, speed: Math.min(5, Number(speed) || 1) }), simulated: true });
}

export function stop(req, res) {
  res.json({ sim: stopSim(), simulated: true });
}

/* One manual tick — step-by-step demo walkthrough */
export async function step(req, res) {
  const { agentId, scenario = 'B' } = req.body || {};
  if (!agentId) return res.status(400).json({ error: 'agentId required' });
  if (!['A', 'B', 'C', 'D'].includes(scenario)) return res.status(400).json({ error: 'scenario must be A|B|C|D' });
  if (!(await canControlAgent(req.user, agentId))) return res.status(403).json({ error: 'Insufficient role' });
  const result = await stepSim({ agentId, scenario });
  if (result.error) return res.status(409).json({ error: result.error });
  res.json({ sim: result, simulated: true });
}

export async function reset(req, res) {
  const { agentId } = req.body || {};
  if (!agentId) return res.status(400).json({ error: 'agentId required' });
  if (!(await canControlAgent(req.user, agentId))) return res.status(403).json({ error: 'Insufficient role' });
  const result = await resetSimAgent(agentId);
  if (result.error) return res.status(404).json({ error: result.error });
  res.json({ reset: result, simulated: true });
}

export function status(req, res) {
  res.json({ sim: simStatus(), simulated: true });
}
