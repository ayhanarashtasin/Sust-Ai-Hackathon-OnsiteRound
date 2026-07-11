import Agent from '../models/Agent.js';
import Alert from '../models/Alert.js';

const PROVIDERS = ['bKash', 'Nagad', 'Rocket'];
const priority = { normal: 0, watch: 1, critical: 2 };

function statusFor(alert) {
  return alert.severity === 'critical' ? 'critical' : 'watch';
}

export function buildPublicServiceStatus(agents, alerts) {
  const areas = new Map();
  for (const agent of agents) {
    if (!areas.has(agent.area)) {
      areas.set(agent.area, {
        area: agent.area,
        providers: Object.fromEntries(PROVIDERS.map((provider) => [provider, 'normal'])),
      });
    }
  }
  for (const alert of alerts) {
    const area = areas.get(alert.area);
    if (!area || ['resolved', 'dismissed'].includes(alert.status)) continue;
    const affected = alert.provider ? [alert.provider] : PROVIDERS;
    for (const provider of affected) {
      const next = statusFor(alert);
      if (priority[next] > priority[area.providers[provider]]) area.providers[provider] = next;
    }
  }
  return [...areas.values()]
    .sort((left, right) => left.area.localeCompare(right.area))
    .map((area) => ({ area: area.area, providers: PROVIDERS.map((provider) => ({ provider, status: area.providers[provider] })) }));
}

export async function getServiceStatus(_req, res) {
  const [agents, alerts] = await Promise.all([
    Agent.find({}, 'area').lean(),
    Alert.find({}, 'area provider severity status').lean(),
  ]);
  res.json({ areas: buildPublicServiceStatus(agents, alerts), simulated: true, updatedAt: new Date() });
}
