import { Link } from 'react-router-dom';
import { api } from '../api/client.js';
import { usePolling } from '../hooks/usePolling.js';
import { useLang } from '../i18n/index.js';
import AlertsFeed from '../components/AlertsFeed.jsx';

/* Role-scoped landing: agents you can see + open alerts routed near you. */
const taka = (n) => `৳${Number(n || 0).toLocaleString('en-IN')}`;

export default function Dashboard() {
  const { t } = useLang();
  const { data: agentsData, refresh: refreshAgents } = usePolling(() => api.agents(), 5000, []);
  const { data: alertsData, refresh: refreshAlerts } = usePolling(() => api.alerts('?status=new,acknowledged,in_progress,escalated'), 3000, []);

  return (
    <div className="page">
      <div className="grid cols-2">
        <div className="card">
          <h2>{t.agents}</h2>
          {(agentsData?.agents || []).map((a) => (
            <Link key={a.agentId} to={`/agent/${a.agentId}`}>
              <div className="alert-item agent-card">
                <div className="alert-head">
                  <span className="alert-title">{a.name}</span>
                  <span className="chip">{a.agentId}</span>
                  <span className="chip">{t.area}: {a.area}</span>
                </div>
                <div style={{ fontSize: 13, color: 'var(--dim)', marginTop: 6 }}>
                  💵 {taka(a.cashBalance)} · {a.providers.map((p) => `${p.provider} ${taka(p.emoneyBalance)}`).join(' · ')}
                </div>
              </div>
            </Link>
          ))}
          {!agentsData && <div style={{ color: 'var(--dim)' }}>{t.loading}</div>}
        </div>
        <AlertsFeed alerts={alertsData?.alerts || []} compact onDismiss={() => Promise.all([refreshAgents(), refreshAlerts()])} />
      </div>
    </div>
  );
}
