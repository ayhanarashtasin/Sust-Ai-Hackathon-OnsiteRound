import { useLang, roleLabel } from '../i18n/index.js';

/* Audit trail (Scenario D): WHO did what, when — actor identity + role, every transition traceable. */
export default function CaseTimeline({ history = [] }) {
  const { t } = useLang();
  return (
    <div className="card">
      <h2>{t.history}</h2>
      <ul className="timeline">
        {history.map((h, i) => (
          <li key={i}>
            <div>
              <strong>{h.action}</strong> — {h.actorName ? `${h.actorName} (${roleLabel(t, h.actorRole)})` : roleLabel(t, h.actorRole)}
              {h.note ? ` · ${h.note}` : ''}
            </div>
            <div className="ts">{new Date(h.ts).toLocaleString()}</div>
          </li>
        ))}
      </ul>
    </div>
  );
}
