/* Single API client — all fetches go through here (views never call fetch directly). */
const BASE = '/api';

function token() {
  return localStorage.getItem('token');
}

async function request(path, options = {}) {
  const res = await fetch(`${BASE}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(token() ? { Authorization: `Bearer ${token()}` } : {}),
      ...options.headers,
    },
  });
  if (res.status === 401) {
    localStorage.removeItem('token');
    localStorage.removeItem('user');
    if (!path.startsWith('/auth')) window.location.href = '/login';
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

export const api = {
  login: (email, password) => request('/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) }),
  agents: () => request('/agents'),
  managementOverview: () => request('/agents/management-overview'),
  publicServiceStatus: () => request('/public/service-status'),
  agent: (id) => request(`/agents/${id}`),
  transactions: (id, params = '') => request(`/agents/${id}/transactions${params}`),
  forecast: (id) => request(`/agents/${id}/forecast`),
  decisionSupport: (id) => request(`/agents/${id}/decision-support`),
  anomalies: (id) => request(`/agents/${id}/anomalies`),
  modelStatus: () => request('/models/status'),
  modelMetrics: () => request('/models/metrics'),
  alerts: (qs = '') => request(`/alerts${qs}`),
  alert: (id) => request(`/alerts/${id}`),
  assignableUsers: () => request('/alerts/assignable-users'),
  alertAction: (id, action, body = {}) => request(`/alerts/${id}/${action}`, { method: 'POST', body: JSON.stringify(body) }),
  dismissAlert: (id) => request(`/alerts/${id}/dismiss`, { method: 'POST', body: JSON.stringify({}) }),
  clearAlerts: (agentId) => request(`/alerts${agentId ? `?agentId=${agentId}` : ''}`, { method: 'DELETE' }),
  simStart: (agentId, scenario, speed = 2) => request('/sim/start', { method: 'POST', body: JSON.stringify({ agentId, scenario, speed }) }),
  simStop: () => request('/sim/stop', { method: 'POST' }),
  simStep: (agentId, scenario) => request('/sim/step', { method: 'POST', body: JSON.stringify({ agentId, scenario }) }),
  simReset: (agentId) => request('/sim/reset', { method: 'POST', body: JSON.stringify({ agentId }) }),
  simStatus: () => request('/sim/status'),
};
