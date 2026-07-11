import Agent from '../models/Agent.js';
import { startSim, stopSim, stepSim, resetSimAgent, simStatus } from '../services/simEngine.js';

/* Demo streamer control — "Eid rush" button lands here. SIMULATED transactions only. */
export function start(req, res) {
  const { agentId, scenario = 'B', speed = 1 } = req.body || {};
  if (!agentId) return res.status(400).json({ error: 'agentId required' });
  if (!['A', 'B', 'C', 'D'].includes(scenario)) return res.status(400).json({ error: 'scenario must be A|B|C|D' });
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
  const result = await stepSim({ agentId, scenario });
  if (result.error) return res.status(409).json({ error: result.error });
  res.json({ sim: result, simulated: true });
}

export async function reset(req, res) {
  const { agentId } = req.body || {};
  if (!agentId) return res.status(400).json({ error: 'agentId required' });
  if (req.user.role === 'agent' && req.user.agentId !== agentId) return res.status(403).json({ error: 'Insufficient role' });
  if (req.user.role === 'field_officer' && !(await Agent.exists({ agentId, area: req.user.area }))) {
    return res.status(403).json({ error: 'Insufficient role' });
  }
  const result = await resetSimAgent(agentId);
  if (result.error) return res.status(404).json({ error: result.error });
  res.json({ reset: result, simulated: true });
}

export function status(req, res) {
  res.json({ sim: simStatus(), simulated: true });
}
