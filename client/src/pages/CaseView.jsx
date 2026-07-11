import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { api } from '../api/client.js';
import { usePolling } from '../hooks/usePolling.js';
import { useAuth } from '../context/AuthContext.jsx';
import { useLang, alertTitle, alertMessage, alertNextStep, statusLabel, roleLabel } from '../i18n/index.js';
import ConfidenceMeter from '../components/ConfidenceMeter.jsx';
import CaseTimeline from '../components/CaseTimeline.jsx';
import AlertExplanation from '../components/AlertExplanation.jsx';
import LiveStatus from '../components/LiveStatus.jsx';

/*
  Scenario D — the coordination case (M5/AC-5):
  who received it (routedToRole), who owns it (ownerName — an identity, not a
  checkmark), recommended next step, ack / assign / escalate / resolve actions,
  and the full audit timeline. Action buttons mirror the server's transition
  state machine — an illegal action is never offered (and the server enforces
  it anyway). Escalation = AUTHORIZED SUPPORT REQUEST. Nothing here moves money.
*/
const CAN_ACK = ['new'];
const CAN_ASSIGN = ['new', 'acknowledged', 'in_progress'];
const CAN_ESCALATE = ['new', 'acknowledged', 'in_progress'];
const CAN_RESOLVE = ['acknowledged', 'in_progress', 'escalated'];
const CAN_DISMISS = ['new', 'acknowledged'];

export default function CaseView() {
  const { id } = useParams();
  const { user } = useAuth();
  const { t, lang } = useLang();
  const [note, setNote] = useState('');
  const [assignee, setAssignee] = useState('');
  const [assignableUsers, setAssignableUsers] = useState([]);
  const [busy, setBusy] = useState(false);
  const [showExplanation, setShowExplanation] = useState(false);
  const { data, error, lastUpdated, refresh } = usePolling(() => api.alert(id), 3000, [id]);

  const a = data?.alert;
  const isRoutedWorker = a && user?.role === a.routedToRole && (!a.ownerUserId || !user.id || a.ownerUserId === user.id);
  const canManage = ['field_officer', 'ops', 'risk'].includes(user?.role) && isRoutedWorker;
  const canAck = user?.role === 'agent' || isRoutedWorker;

  useEffect(() => {
    if (canManage) api.assignableUsers().then((d) => setAssignableUsers(d.users || [])).catch(() => {});
  }, [canManage]);

  if (!a) return <div className="page">{error ? <LiveStatus lastUpdated={lastUpdated} error={error} /> : t.loading}</div>;

  async function act(action, body = {}) {
    setBusy(true);
    try {
      await api.alertAction(id, action, body);
      await refresh();
    } catch (err) {
      window.alert(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function dismiss() {
    if (!window.confirm(t.dismissConfirm)) return;
    return act('dismiss');
  }

  const st = a.status;

  return (
    <div className="page">
      <div className={`card alert-item ${a.severity}`} style={{ marginBottom: 0 }}>
        <div className="alert-head">
          <span className="alert-title" style={{ fontSize: 17 }}>{alertTitle(a, lang)}</span>
          <span className={`chip ${a.severity}`}>{a.severity}</span>
          {a.provider && <span className="chip">{a.provider}</span>}
          <span className="chip status">{t.status}: {statusLabel(t, st)}</span>
          <ConfidenceMeter value={a.confidence} />
          <span style={{ marginLeft: 'auto' }}><LiveStatus lastUpdated={lastUpdated} error={error} /></span>
        </div>
        <div className="alert-msg">{alertMessage(a, lang)}</div>
        <div className="next-step">▶ {t.nextStep}: {alertNextStep(a, lang)}</div>
        <div className="review-note">{a.requiresReview ? t.requiresReview : t.infoOnly}</div>
        <div style={{ display: 'flex', gap: 16, marginTop: 10, fontSize: 13, color: 'var(--dim)', flexWrap: 'wrap' }}>
          <span>{t.routedTo}: <strong>{roleLabel(t, a.routedToRole)}</strong></span>
          <span>{t.owner}: <strong>{a.ownerName || (a.ownerUserId ? a.ownerUserId : `— ${t.unassigned}`)}</strong></span>
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
          {canAck && CAN_DISMISS.includes(st) && (
            <button className="danger" disabled={busy} onClick={dismiss}>
              {busy ? t.deleting : t.dismiss}
            </button>
          )}
        </div>
        {showExplanation && <AlertExplanation alert={a} id={`explanation-${a.alertId}`} />}
      </div>

      {(canAck || canManage) && !['resolved', 'dismissed'].includes(st) && (
        <div className="card simbar">
          {canAck && CAN_ACK.includes(st) && <button className="primary" disabled={busy} onClick={() => act('acknowledge')}>✓ {t.acknowledge}</button>}
          {canManage && CAN_ASSIGN.includes(st) && assignableUsers.length > 0 && (
            <>
              <select value={assignee} onChange={(e) => setAssignee(e.target.value)}>
                <option value="">{t.assignTo}</option>
                {assignableUsers.filter((u) => u.role === a.routedToRole).map((u) => (
                  <option key={u.id} value={u.id}>{u.name} ({roleLabel(t, u.role)})</option>
                ))}
              </select>
              <button disabled={busy || !assignee} onClick={() => act('assign', { userId: assignee })}>👤 {t.assign}</button>
            </>
          )}
          {canManage && CAN_ESCALATE.includes(st) && (
            <button disabled={busy} onClick={() => act('escalate', { toRole: 'risk', note: 'Escalated for review — authorized support request' })}>⬆ {t.escalate}</button>
          )}
          {canManage && CAN_RESOLVE.includes(st) && (
            <button className="success" disabled={busy} onClick={() => act('resolve', { note: 'Resolved after review' })}>✔ {t.resolve}</button>
          )}
          <input value={note} onChange={(e) => setNote(e.target.value)} placeholder={`${t.addNote}…`} style={{ flex: 1, minWidth: 160 }} />
          <button disabled={busy} onClick={() => { if (note.trim()) { act('note', { note }); setNote(''); } }}>{t.addNote}</button>
        </div>
      )}

      <div className="grid cols-2">
        <div className="card">
          <details>
            <summary>{t.technicalEvidence}</summary>
            <div className="evidence">{JSON.stringify(a.evidence, null, 2)}</div>
          </details>
          {a.evidenceHistory?.length > 0 && (
            <details style={{ marginTop: 8 }}>
              <summary>{t.evidence} — history ({a.evidenceHistory.length})</summary>
              <div className="evidence">{JSON.stringify(a.evidenceHistory.slice(-5), null, 2)}</div>
            </details>
          )}
        </div>
        <CaseTimeline history={a.history} />
      </div>
    </div>
  );
}
