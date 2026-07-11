import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { api } from '../api/client.js';
import { usePolling } from '../hooks/usePolling.js';
import { useAuth } from '../context/AuthContext.jsx';
import { useLang } from '../i18n/index.js';
import BalanceHero from '../components/BalanceHero.jsx';
import ForecastPanel from '../components/ForecastPanel.jsx';
import AlertsFeed from '../components/AlertsFeed.jsx';

/*
  The demo spine page: unified balances + forecast + live alerts + "Eid rush" control.
  Client POLLS (3s) — all computation happened on the sim tick (compute-on-write).
*/
export default function AgentDetail() {
  const { id } = useParams();
  const { user } = useAuth();
  const { t } = useLang();
  const [scenario, setScenario] = useState('B');
  const [simRunning, setSimRunning] = useState(false);

  const [stepCount, setStepCount] = useState(0);
  const [tickResult, setTickResult] = useState(null);
  const [stepping, setStepping] = useState(false);
  const [clearing, setClearing] = useState(false);

  const { data: agentData, refresh: refreshAgent } = usePolling(() => api.agent(id), 3000, [id]);
  const { data: forecastData, refresh: refreshForecast } = usePolling(() => api.forecast(id), 3000, [id]);
  const { data: alertsData, refresh: refreshAlerts } = usePolling(() => api.alerts(`?agentId=${id}&status=new,acknowledged,in_progress,escalated`), 3000, [id]);

  async function toggleSim() {
    if (simRunning) {
      await api.simStop();
      setSimRunning(false);
    } else {
      await api.simStart(id, scenario, 2);
      setSimRunning(true);
      setStepCount(0);
      setTickResult(null);
    }
  }

  /* Restore the seeded baseline so every walkthrough starts from the same state. */
  async function resetDemo() {
    if (!window.confirm(t.resetConfirm)) return;
    setClearing(true);
    try {
      await api.simReset(id);
      setSimRunning(false);
      setStepCount(0);
      setTickResult(null);
      await Promise.all([refreshAgent(), refreshForecast(), refreshAlerts()]);
    } catch (error) {
      window.alert(error.message);
    } finally {
      setClearing(false);
    }
  }

  /* Manual walkthrough: one pipeline tick per click, then refresh immediately
     so the presenter sees cause → effect without waiting for the 3s poll. */
  async function stepOnce() {
    setStepping(true);
    try {
      const { sim } = await api.simStep(id, scenario);
      setStepCount(sim.tickCount);
      setTickResult(sim);
      await Promise.all([refreshAgent(), refreshForecast(), refreshAlerts()]);
    } finally {
      setStepping(false);
    }
  }

  const dq = forecastData?.dataQualityWarnings || [];
  const canClear = ['agent', 'field_officer', 'ops', 'risk'].includes(user?.role);

  return (
    <div className="page">
      <div className="simbar card">
        <span style={{ color: 'var(--dim)', fontSize: 13 }}>{t.scenario}:</span>
        <select value={scenario} onChange={(e) => setScenario(e.target.value)} disabled={simRunning}>
          <option value="A">A — Hidden provider shortage</option>
          <option value="B">B — Liquidity + unusual activity</option>
          <option value="C">C — Data inconsistency</option>
          <option value="D">D — Coordinated response (critical)</option>
        </select>
        <button className={simRunning ? 'danger' : 'success'} onClick={toggleSim}>
          {simRunning ? `⏹ ${t.stopSim}` : `🌙 ${t.eidRush} ▶`}
        </button>
        <button onClick={stepOnce} disabled={simRunning || stepping} title={simRunning ? t.stepDisabledHint : ''}>
          ⏭ {stepping ? t.loading : t.step}{stepCount > 0 && !simRunning ? ` (${stepCount})` : ''}
        </button>
        {canClear && (
          <button className="danger" onClick={resetDemo} disabled={clearing} title={t.resetHint}>
            🧹 {clearing ? t.resetting : t.resetDemo}
          </button>
        )}
        <span style={{ fontSize: 12, color: 'var(--dim)' }}>SIMULATED transactions only — no real money moves.</span>
      </div>

      {dq.length > 0 && (
        <div className="dq-banner">
          ⚠ {dq.map((w) => `${w.provider}: no data for ${w.ageMinutes} min`).join(' · ')} — {t.staleFeed}. Provider balances stay separate; no recommendation is issued from stale feeds.
        </div>
      )}

      {tickResult && (
        <div className="tick-summary">
          <strong>{t.tickResult} {tickResult.tickCount}</strong>
          <span>{tickResult.transactionCount} {t.transactions}</span>
          <span>{tickResult.findingCount} {t.findings}</span>
          <span>{(tickResult.alerts || []).filter((alert) => alert.created).length} {t.newAlerts}</span>
          <span>{(tickResult.alerts || []).filter((alert) => !alert.created).length} {t.updatedAlerts}</span>
        </div>
      )}

      <div className="grid cols-2">
        <BalanceHero agent={agentData?.agent} staleProviders={agentData?.staleProviders || []} />
        <ForecastPanel forecasts={forecastData?.forecasts || []} />
      </div>

      <AlertsFeed
        alerts={alertsData?.alerts || []}
        highlightedAlertIds={tickResult?.alerts?.map((alert) => alert.alertId) || []}
        onDismiss={() => {
          setStepCount(0);
          setTickResult(null);
          setSimRunning(false);
          return Promise.all([refreshAgent(), refreshForecast(), refreshAlerts()]);
        }}
      />
    </div>
  );
}
