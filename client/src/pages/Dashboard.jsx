import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api/client.js';
import { usePolling } from '../hooks/usePolling.js';
import { useAuth } from '../context/AuthContext.jsx';
import { useLang, kindLabel, statusLabel } from '../i18n/index.js';
import AlertsFeed from '../components/AlertsFeed.jsx';
import LiveStatus from '../components/LiveStatus.jsx';

/* Role-scoped landing: agents you can see + open alerts routed near you,
   filterable by provider / type / status (server-side query params). */
const taka = (n) => `৳${Number(n || 0).toLocaleString('en-IN')}`;
const PROVIDERS = ['bKash', 'Nagad', 'Rocket'];
const KINDS = ['liquidity', 'anomaly', 'data_quality'];
const OPEN_STATUSES = 'new,acknowledged,in_progress,escalated';

export default function Dashboard() {
  const { t } = useLang();
  const { user } = useAuth();
  const [provider, setProvider] = useState('');
  const [kind, setKind] = useState('');
  const [status, setStatus] = useState('');
  const [riskBand, setRiskBand] = useState('');
  const [decisionSource, setDecisionSource] = useState('');

  const qs = new URLSearchParams();
  qs.set('status', status || OPEN_STATUSES);
  if (provider) qs.set('provider', provider);
  if (kind) qs.set('kind', kind);
  if (riskBand) qs.set('riskBand', riskBand);
  if (decisionSource) qs.set('decisionSource', decisionSource);

  const isManagement = user?.role === 'management';
  const canViewAgents = !isManagement && user?.role !== 'risk';
  const canViewAlerts = !isManagement;
  const { data: agentsData, refresh: refreshAgents } = usePolling(
    () => canViewAgents ? api.agents() : Promise.resolve({ agents: [] }),
    5000,
    [canViewAgents],
  );
  const { data: alertsData, error: alertsError, lastUpdated, refresh: refreshAlerts } =
    usePolling(() => canViewAlerts ? api.alerts(`?${qs.toString()}`) : Promise.resolve({ alerts: [] }), 3000, [provider, kind, status, riskBand, decisionSource, canViewAlerts]);
  const { data: managementData, error: managementError, lastUpdated: managementUpdated } = usePolling(
    () => isManagement ? api.managementOverview() : Promise.resolve(null),
    5000,
    [isManagement],
  );

  if (isManagement) {
    const overview = managementData?.overview;
    const readiness = {
      ready: t.readinessReady,
      attention: t.readinessAttention,
      critical: t.readinessCritical,
    };
    return (
      <div className="page">
        <div className="simbar card" style={{ justifyContent: 'space-between' }}>
          <strong>{t.managementOverview}</strong>
          <LiveStatus lastUpdated={managementUpdated} error={managementError} />
        </div>
        <div className="grid cols-2">
          <div className="card">
            <h2>{t.areaReadiness}</h2>
            {(overview?.areas || []).map((area) => (
              <div className="alert-item agent-card" key={area.area}>
                <div className="alert-head">
                  <span className="alert-title">{area.area}</span>
                  <span className={`chip ${area.readiness === 'critical' ? 'critical' : ''}`}>{readiness[area.readiness]}</span>
                </div>
                <div style={{ fontSize: 13, color: 'var(--dim)', marginTop: 6 }}>
                  {area.agentCount} {t.agents} · {t.openAlerts}: {area.openAlerts} · {t.criticalAlerts}: {area.criticalAlerts}
                </div>
              </div>
            ))}
            {!overview && <div style={{ color: 'var(--dim)' }}>{t.loading}</div>}
          </div>
          <div className="card">
            <h2>{t.peerComparison}</h2>
            {[...(overview?.areas || [])]
              .sort((left, right) => right.openAlerts / Math.max(1, right.agentCount) - left.openAlerts / Math.max(1, left.agentCount))
              .map((area) => (
                <div className="alert-item" key={`peer-${area.area}`}>
                  <strong>{area.area}</strong> · {t.openAlertsPerAgent}: {(area.openAlerts / Math.max(1, area.agentCount)).toFixed(1)}
                </div>
              ))}
            <h2>{t.recurringPatterns}</h2>
            {(overview?.recurring || []).map((item) => (
              <div className="alert-item" key={`${item.area}-${item.subtype}`}>
                <strong>{item.area}</strong> · {item.subtype} ({item.count})
              </div>
            ))}
            {overview && !overview.recurring.length && <div style={{ color: 'var(--dim)' }}>{t.noAlerts}</div>}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="page">
      <div className="simbar card" style={{ justifyContent: 'flex-start' }}>
        <span style={{ color: 'var(--dim)', fontSize: 13 }}>{t.filterProvider}:</span>
        <select value={provider} onChange={(e) => setProvider(e.target.value)}>
          <option value="">{t.all}</option>
          {PROVIDERS.map((p) => <option key={p} value={p}>{p}</option>)}
        </select>
        <span style={{ color: 'var(--dim)', fontSize: 13 }}>{t.filterKind}:</span>
        <select value={kind} onChange={(e) => setKind(e.target.value)}>
          <option value="">{t.all}</option>
          {KINDS.map((k) => <option key={k} value={k}>{kindLabel(t, k)}</option>)}
        </select>
        <span style={{ color: 'var(--dim)', fontSize: 13 }}>{t.filterStatus}:</span>
        <select value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">{t.all} (open)</option>
          {['new', 'acknowledged', 'in_progress', 'escalated', 'resolved', 'dismissed'].map((s) => (
            <option key={s} value={s}>{statusLabel(t, s)}</option>
          ))}
        </select>
        <span style={{ color: 'var(--dim)', fontSize: 13 }}>Risk:</span>
        <select value={riskBand} onChange={(e) => setRiskBand(e.target.value)}>
          <option value="">{t.all}</option>
          {['low', 'medium', 'high', 'critical', 'unknown'].map((band) => <option key={band} value={band}>{band}</option>)}
        </select>
        <span style={{ color: 'var(--dim)', fontSize: 13 }}>Source:</span>
        <select value={decisionSource} onChange={(e) => setDecisionSource(e.target.value)}>
          <option value="">{t.all}</option>
          {['hybrid', 'model', 'rules_only'].map((source) => <option key={source} value={source}>{source.replaceAll('_', ' ')}</option>)}
        </select>
        <span style={{ marginLeft: 'auto' }}><LiveStatus lastUpdated={lastUpdated} error={alertsError} /></span>
      </div>

      <div className="grid cols-2" style={canViewAgents ? undefined : { gridTemplateColumns: '1fr' }}>
        {canViewAgents && <div className="card">
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
        </div>}
        <AlertsFeed alerts={alertsData?.alerts || []} compact onDismiss={() => Promise.all([refreshAgents(), refreshAlerts()])} />
      </div>
    </div>
  );
}
