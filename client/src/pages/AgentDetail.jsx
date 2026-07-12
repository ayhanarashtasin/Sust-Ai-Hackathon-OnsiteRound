import { useState, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import { api } from '../api/client.js';
import { usePolling } from '../hooks/usePolling.js';
import { useAuth } from '../context/AuthContext.jsx';
import { useLang, issueLabel } from '../i18n/index.js';
import BalanceHero from '../components/BalanceHero.jsx';
import ForecastPanel from '../components/ForecastPanel.jsx';
import AlertsFeed from '../components/AlertsFeed.jsx';
import LiveStatus from '../components/LiveStatus.jsx';
import RiskConfidence from '../components/RiskConfidence.jsx';
import DecisionSummary from '../components/DecisionSummary.jsx';
import ModelStatus from '../components/ModelStatus.jsx';

/*
  The demo spine page: unified balances + forecast + live alerts + "Eid rush" control.
  Client POLLS (3s) — alert generation happened on the sim tick (compute-on-write).
*/
export default function AgentDetail() {
  const { id } = useParams();
  const { user } = useAuth();
  const { t } = useLang();
  const [scenario, setScenario] = useState('B');

  const [stepCount, setStepCount] = useState(0);
  const [tickResult, setTickResult] = useState(null);
  const [stepping, setStepping] = useState(false);
  const [clearing, setClearing] = useState(false);

  const { data: simData, refresh: refreshSim } = usePolling(() => api.simStatus(), 2000, []);
  const activeSim = simData?.sim;
  const simRunning = activeSim?.running === true && activeSim.agentId === id;
  const simRunningElsewhere = activeSim?.running === true && activeSim.agentId !== id;
  const simStatusPending = !simData;

  const { data: agentData, refresh: refreshAgent } = usePolling(() => api.agent(id), 3000, [id], !simRunning);
  const { data: forecastData, error: forecastError, lastUpdated, refresh: refreshForecast } = usePolling(() => api.forecast(id), 3000, [id], !simRunning);
  const { data: alertsData, refresh: refreshAlerts } = usePolling(() => api.alerts(`?agentId=${id}&status=new,acknowledged,in_progress,escalated`), 3000, [id], !simRunning);
  const { data: decisionData, refresh: refreshDecision } = usePolling(() => api.decisionSupport(id), 3000, [id], !simRunning);
  const { data: modelData } = usePolling(() => api.modelStatus(), 10000, [], !simRunning);
  // Force simulation to stop when navigating to this page so it starts frozen
  // and only updates when explicitly clicking "Next" or "Eid Rush".
  useEffect(() => {
    api.simStop().catch(console.error);
  }, []);


  async function toggleSim() {
    try {
      if (simRunning) {
        await api.simStop();
      } else {
        await api.simStart(id, scenario, 2);
        setStepCount(0);
        setTickResult(null);
      }
    } finally {
      // The timer belongs to the server process, so refresh its state rather
      // than relying on a tab-local flag after reloads or other sessions.
      await refreshSim();
    }
  }

  /* Restore the seeded baseline so every walkthrough starts from the same state. */
  async function resetDemo() {
    if (!window.confirm(t.resetConfirm)) return;
    setClearing(true);
    try {
      await api.simReset(id);
      setStepCount(0);
      setTickResult(null);
      await Promise.all([refreshAgent(), refreshForecast(), refreshAlerts(), refreshDecision(), refreshSim()]);
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
      await Promise.all([refreshAgent(), refreshForecast(), refreshAlerts(), refreshDecision()]);
    } finally {
      setStepping(false);
    }
  }

  // All data-quality problems (stale / missing / conflicting) — not just staleness
  const issuesByProvider = forecastData?.issuesByProvider || {};
  const issueEntries = Object.entries(issuesByProvider);
  const canControl = user?.role === 'agent' || user?.role === 'field_officer'
    || (user?.role === 'ops' && user.providerScope?.includes('all'));
  const mainPressure = decisionData?.decisionSupport?.mainPressure;
  const models = modelData?.models || [];
  const unavailableModel = models.find((model) => !model.available);

  return (
    <div className="page">
      <div className="simbar card">
        <span style={{ color: 'var(--dim)', fontSize: 13 }}>{t.scenario}:</span>
        <select value={scenario} onChange={(e) => setScenario(e.target.value)} disabled={simStatusPending || simRunning || simRunningElsewhere}>
          <option value="A">A — Hidden provider shortage</option>
          <option value="B">B — Liquidity + unusual activity</option>
          <option value="C">C — Data inconsistency</option>
          <option value="D">D — Coordinated response (critical)</option>
        </select>
        {canControl && (
          <>
            <button className={simRunning ? 'danger' : 'success'} onClick={toggleSim} disabled={simStatusPending || simRunningElsewhere}>
              {simRunning ? `⏹ ${t.stopSim}` : `${t.eidRush} ▶`}
            </button>
            <button onClick={stepOnce} disabled={simStatusPending || simRunning || simRunningElsewhere || stepping} title={simRunning || simRunningElsewhere ? t.stepDisabledHint : ''}>
              ⏭ {stepping ? t.loading : t.step}{stepCount > 0 && !simRunning ? ` (${stepCount})` : ''}
            </button>
            <button className="danger" onClick={resetDemo} disabled={simStatusPending || simRunningElsewhere || clearing} title={t.resetHint}>
              {clearing ? t.resetting : t.resetDemo}
            </button>
          </>
        )}
        {simRunningElsewhere && <span style={{ fontSize: 12, color: 'var(--warn)' }}>Simulation is active for {activeSim.agentId}.</span>}
        <span style={{ fontSize: 12, color: 'var(--dim)' }}>SIMULATED transactions only — no real money moves.</span>
        <span style={{ marginLeft: 'auto' }}><LiveStatus lastUpdated={lastUpdated} error={forecastError} /></span>
      </div>

      {issueEntries.length > 0 && (
        <div className="dq-banner">
          ⚠ {issueEntries.map(([p, issues]) => `${p}: ${issues.map((i) => issueLabel(t, i)).join(' + ')}`).join(' · ')} — {t.recWithheld}. Provider balances stay separate; no recommendation is issued from bad data.
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

      <div className="grid cols-2">
        <RiskConfidence
          risk={mainPressure?.riskScore}
          confidence={mainPressure?.confidenceScore}
          riskBand={mainPressure?.riskBand}
          reducedConfidenceReason={mainPressure?.fallbackReason || mainPressure?.dataFreshness?.note}
        />
        <DecisionSummary
          pressure={mainPressure}
          source={mainPressure ? { type: mainPressure.decisionSource, label: mainPressure.model?.type, version: mainPressure.model?.version } : null}
          evidence={mainPressure?.evidence}
          triggeredRules={mainPressure?.triggeredRules}
          dataFreshness={mainPressure?.dataFreshness}
          safeNextStep={mainPressure?.safeNextStep}
        />
      </div>

      <ModelStatus
        available={models.length > 0 ? models.every((model) => model.available) : undefined}
        type={models.filter((model) => model.available).map((model) => model.modelType).filter(Boolean).join(', ')}
        version={models.filter((model) => model.available).map((model) => model.modelVersion).filter(Boolean).join(', ')}
        name="Offline tabular decision models"
        fallbackReason={unavailableModel?.fallbackReason}
      />

      <AlertsFeed
        alerts={alertsData?.alerts || []}
        highlightedAlertIds={tickResult?.alerts?.map((alert) => alert.alertId) || []}
        onDismiss={() => {
          setStepCount(0);
          setTickResult(null);
          return Promise.all([refreshAgent(), refreshForecast(), refreshAlerts(), refreshDecision()]);
        }}
      />
    </div>
  );
}
