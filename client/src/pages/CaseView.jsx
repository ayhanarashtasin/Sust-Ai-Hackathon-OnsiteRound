import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { api } from '../api/client.js';
import { usePolling } from '../hooks/usePolling.js';
import { useAuth } from '../context/AuthContext.jsx';
import { useLang, alertTitle, alertMessage, alertNextStep } from '../i18n/index.js';
import ConfidenceMeter from '../components/ConfidenceMeter.jsx';
import CaseTimeline from '../components/CaseTimeline.jsx';
import AlertExplanation from '../components/AlertExplanation.jsx';

/*
  Scenario D — the coordination case (M5/AC-5):
  who received it (routedToRole), who owns it (ownerUserId), recommended next step,
  ack / escalate / resolve actions, and the full audit timeline.
  Escalation = AUTHORIZED SUPPORT REQUEST. Nothing here moves money.
*/
export default function CaseView() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const { t, lang } = useLang();
  const [note, setNote] = useState('');
  const [deleting, setDeleting] = useState(false);
  const [showExplanation, setShowExplanation] = useState(false);
  const { data, refresh } = usePolling(() => api.alert(id), 3000, [id]);
  const a = data?.alert;
  if (!a) return <div className="page">{t.loading}</div>;

  async function act(action, body = {}) {
    await api.alertAction(id, action, body);
    refresh();
  }

  async function dismiss() {
    if (!window.confirm(t.dismissConfirm)) return;
    setDeleting(true);
    try {
      await api.deleteAlert(id);
      navigate('/');
    } catch (error) {
      window.alert(error.message);
      setDeleting(false);
    }
  }

  const open = !['resolved', 'dismissed'].includes(a.status);
  const canAct = ['field_officer', 'ops', 'risk'].includes(user?.role);
  const canDismiss = ['agent', 'field_officer', 'ops', 'risk'].includes(user?.role);

  return (
    <div className="page">
      <div className={`card alert-item ${a.severity}`} style={{ marginBottom: 0 }}>
        <div className="alert-head">
          <span className="alert-title" style={{ fontSize: 17 }}>{alertTitle(a, lang)}</span>
          <span className={`chip ${a.severity}`}>{a.severity}</span>
          {a.provider && <span className="chip">{a.provider}</span>}
          <span className="chip status">{t.status}: {a.status}</span>
          <ConfidenceMeter value={a.confidence} />
        </div>
        <div className="alert-msg">{alertMessage(a, lang)}</div>
        <div className="next-step">▶ {t.nextStep}: {alertNextStep(a, lang)}</div>
        <div className="review-note">{t.requiresReview}</div>
        <div style={{ display: 'flex', gap: 16, marginTop: 10, fontSize: 13, color: 'var(--dim)', flexWrap: 'wrap' }}>
          <span>{t.routedTo}: <strong>{a.routedToRole}</strong></span>
          <span>{t.owner}: <strong>{a.ownerUserId ? '✓ assigned' : '— unassigned'}</strong></span>
          <span>Agent: {a.agentId} ({a.area})</span>
          <span>Source: {a.explanationSource}</span>
        </div>
        {a.possibleNormalReasons?.length > 0 && (
          <div style={{ marginTop: 10, fontSize: 13 }}>
            <span style={{ color: 'var(--dim)' }}>{t.possibleReasons}:</span> {a.possibleNormalReasons.join(' · ')}
          </div>
        )}
        <div className="alert-actions">
          <button aria-expanded={showExplanation} aria-controls={`explanation-${a.alertId}`} onClick={() => setShowExplanation((show) => !show)}>
            {showExplanation ? t.hideExplanation : t.whyThisAlert}
          </button>
          {canDismiss && (
            <button className="danger" disabled={deleting} onClick={dismiss}>
              {deleting ? t.deleting : t.dismiss}
            </button>
          )}
        </div>
        {showExplanation && <AlertExplanation alert={a} id={`explanation-${a.alertId}`} />}
      </div>

      {open && canAct && (
        <div className="card simbar">
          {a.status === 'new' && <button className="primary" onClick={() => act('acknowledge')}>✓ {t.acknowledge}</button>}
          {a.status !== 'escalated' && <button onClick={() => act('escalate', { toRole: 'risk', note: 'Escalated for review — authorized support request' })}>⬆ {t.escalate}</button>}
          <button className="success" onClick={() => act('resolve', { note: 'Resolved after review' })}>✔ {t.resolve}</button>
          <input value={note} onChange={(e) => setNote(e.target.value)} placeholder={`${t.addNote}…`} style={{ flex: 1, minWidth: 160 }} />
          <button onClick={() => { if (note.trim()) { act('note', { note }); setNote(''); } }}>{t.addNote}</button>
        </div>
      )}

      <div className="grid cols-2">
        <div className="card">
          <details>
            <summary>{t.technicalEvidence}</summary>
            <div className="evidence">{JSON.stringify(a.evidence, null, 2)}</div>
          </details>
        </div>
        <CaseTimeline history={a.history} />
      </div>
    </div>
  );
}
