import { useLang } from '../i18n/index.js';

/*
  Data-freshness indicator: shows when the page last successfully polled, and a
  loud retrying state when the API is unreachable — the UI never silently
  presents stale figures as current.
*/
export default function LiveStatus({ lastUpdated, error }) {
  const { t } = useLang();
  if (error) return <span className="live-status error">⛔ {t.connectionLost}</span>;
  if (!lastUpdated) return <span className="live-status">{t.loading}</span>;
  return (
    <span className="live-status">
      ● {t.lastUpdated} {lastUpdated.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
    </span>
  );
}
