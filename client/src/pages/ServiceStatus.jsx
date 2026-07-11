import { api } from '../api/client.js';
import { usePolling } from '../hooks/usePolling.js';
import { useLang } from '../i18n/index.js';
import LiveStatus from '../components/LiveStatus.jsx';

const statusLabel = (t, status) => ({ normal: t.serviceNormal, watch: t.serviceWatch, critical: t.serviceLimited }[status]);

export default function ServiceStatus() {
  const { t } = useLang();
  const { data, error, lastUpdated } = usePolling(() => api.publicServiceStatus(), 15_000, []);

  return (
    <div className="page">
      <div className="card public-status-header">
        <div>
          <h2>{t.serviceStatus}</h2>
          <p>{t.serviceStatusNote}</p>
        </div>
        <LiveStatus lastUpdated={lastUpdated} error={error} />
      </div>
      <div className="grid cols-2">
        {(data?.areas || []).map((area) => (
          <section className="card" key={area.area}>
            <h2>{area.area}</h2>
            <div className="service-provider-list">
              {area.providers.map((provider) => (
                <div className="service-provider" key={provider.provider}>
                  <strong>{provider.provider}</strong>
                  <span className={`service-status ${provider.status}`}>{statusLabel(t, provider.status)}</span>
                </div>
              ))}
            </div>
          </section>
        ))}
      </div>
      {!data && !error && <div className="card">{t.loading}</div>}
    </div>
  );
}
