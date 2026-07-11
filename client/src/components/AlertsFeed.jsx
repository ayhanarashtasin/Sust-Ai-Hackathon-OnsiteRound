import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api/client.js';
import { useAuth } from '../context/AuthContext.jsx';
import { useLang, alertTitle, alertMessage, alertNextStep, statusLabel } from '../i18n/index.js';
import ConfidenceMeter from './ConfidenceMeter.jsx';
import AlertExplanation from './AlertExplanation.jsx';

/*
  Alerts feed (M3/M4/M5): every alert shows severity, confidence, message in the
  active language, evidence on the case page, and careful "requires review" framing.
  Dismiss ARCHIVES the alert (status: dismissed, full history kept) — nothing is deleted.
*/
export default function AlertsFeed({ alerts = [], compact = false, highlightedAlertIds = [], onDismiss }) {
  const { t, lang } = useLang();
  const { user } = useAuth();
  const [deletingId, setDeletingId] = useState(null);
  const [removedIds, setRemovedIds] = useState(() => new Set());
  const [expandedId, setExpandedId] = useState(null);
  const visibleAlerts = alerts.filter((alert) => !removedIds.has(alert.alertId));
  const highlighted = new Set(highlightedAlertIds);
  const canDismiss = (alert) => user?.role === 'agent'
    || (user?.role === alert.routedToRole && (!alert.ownerUserId || !user.id || alert.ownerUserId === user.id));

  async function dismiss(alertId) {
    if (!window.confirm(t.dismissConfirm)) return;
    setDeletingId(alertId);
    try {
      await api.dismissAlert(alertId);
      setRemovedIds((ids) => new Set(ids).add(alertId));
      await onDismiss?.();
    } catch (error) {
      window.alert(error.message);
    } finally {
      setDeletingId(null);
    }
  }

  if (!visibleAlerts.length) return <div className="card"><h2>{t.alerts}</h2><div style={{ color: 'var(--dim)' }}>{t.noAlerts}</div></div>;
  return (
    <div className="card">
      <h2>{t.alerts} ({visibleAlerts.length})</h2>
      {visibleAlerts.map((a) => (
        <div key={a.alertId} className={`alert-item ${a.severity}${highlighted.has(a.alertId) ? ' tick-highlight' : ''}`}>
          <div className="alert-head">
            <span className="alert-title">{alertTitle(a, lang)}</span>
            <span className={`chip ${a.severity}`}>{a.severity}</span>
            {a.provider && <span className="chip">{a.provider}</span>}
            <span className="chip status">{statusLabel(t, a.status)}</span>
            {highlighted.has(a.alertId) && <span className="chip tick-chip">{t.thisTick}</span>}
            <ConfidenceMeter value={a.confidence} />
          </div>
          {!compact && (
            <>
              <div className="alert-msg">{alertMessage(a, lang)}</div>
              <div className="next-step">▶ {alertNextStep(a, lang)}</div>
              <div className="review-note">{a.requiresReview ? t.requiresReview : t.infoOnly}</div>
            </>
          )}
          {expandedId === a.alertId && <AlertExplanation alert={a} id={`explanation-${a.alertId}`} />}
          <div style={{ marginTop: 8, display: 'flex', gap: 8 }}>
            <Link to={`/case/${a.alertId}`}><button>{t.viewCase} →</button></Link>
            <button
              aria-expanded={expandedId === a.alertId}
              aria-controls={`explanation-${a.alertId}`}
              onClick={() => setExpandedId((current) => current === a.alertId ? null : a.alertId)}
            >
              {expandedId === a.alertId ? t.hideExplanation : t.whyThisAlert}
            </button>
            {canDismiss(a) && ['new', 'acknowledged'].includes(a.status) && (
              <button className="danger" disabled={deletingId === a.alertId} onClick={() => dismiss(a.alertId)}>
                {deletingId === a.alertId ? t.deleting : t.dismiss}
              </button>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
