import { useLang, issueLabel } from '../i18n/index.js';
import ConfidenceMeter from './ConfidenceMeter.jsx';

/*
  Forward-looking liquidity insight (M2 / AC-2): which resource, when, how confident.
  SAFE FALLBACK made visible: when a resource has any data issue the server
  withholds its top-up recommendation (recommendationSuppressed) — this panel
  shows WHY instead of showing a number computed from broken data.
*/
const taka = (n) => `৳${Number(n || 0).toLocaleString('en-IN')}`;
const fmtTime = (d) => (d ? new Date(d).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }) : '');

export default function ForecastPanel({ forecasts = [] }) {
  const { t } = useLang();
  return (
    <div className="card">
      <h2>{t.forecast}</h2>
      {forecasts.map((f, i) => (
        <div className="forecast-row" key={i}>
          <span className={`dot ${f.status}`} />
          <strong style={{ width: 110 }}>{f.resource === 'cash' ? '💵 Cash' : f.provider}</strong>
          {f.status === 'stable' ? (
            <span style={{ color: 'var(--dim)' }}>{t.stable} — {t.headroom} {taka(f.currentBalance - f.floorThreshold)}</span>
          ) : (
            <span>
              {t.depletesAt} <strong>{fmtTime(f.projectedDepletionAt)}</strong> ({f.timeToDepletionMin} min) · {t.burnRate} {taka(f.burnRatePerMin)}/min
              {!f.recommendationSuppressed && f.suggestedTopUp > 0 && <> · <span style={{ color: 'var(--ok)' }}>+{taka(f.suggestedTopUp)}</span></>}
            </span>
          )}
          {f.recommendationSuppressed && (
            <span className="stale-tag" title={(f.dataIssues || []).map((i) => issueLabel(t, i)).join(', ')}>
              ⚠ {t.recWithheld}{f.dataIssues?.length ? ` (${f.dataIssues.map((i) => issueLabel(t, i)).join(', ')})` : ''}
            </span>
          )}
          <ConfidenceMeter value={f.confidence} />
        </div>
      ))}
    </div>
  );
}
