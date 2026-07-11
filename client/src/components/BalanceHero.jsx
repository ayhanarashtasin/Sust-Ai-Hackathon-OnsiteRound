import { useLang } from '../i18n/index.js';

/*
  The unified operational view (M1 / AC-1):
  ONE shared physical cash drawer + SEPARATE provider e-money bars.
  The combined total is display-only — providers are never merged.
*/
const CLS = { bKash: 'p-bkash', Nagad: 'p-nagad', Rocket: 'p-rocket' };
const taka = (n) => `৳${Number(n || 0).toLocaleString('en-IN')}`;

function Row({ label, cls, value, max, stale, staleText }) {
  const pct = Math.min(100, Math.round((value / Math.max(1, max)) * 100));
  return (
    <div className="balance-row">
      <div className="balance-label">{label}</div>
      <div className="balance-bar"><div className={`balance-fill ${cls}`} style={{ width: `${pct}%` }} /></div>
      <div className="balance-amt">{taka(value)}</div>
      {stale && <span className="stale-tag">⚠ {staleText}</span>}
    </div>
  );
}

export default function BalanceHero({ agent, staleProviders = [] }) {
  const { t } = useLang();
  if (!agent) return null;
  const max = Math.max(agent.cashBalance, ...agent.providers.map((p) => p.emoneyBalance), 1);
  const total = agent.cashBalance + agent.providers.reduce((s, p) => s + p.emoneyBalance, 0);
  return (
    <div className="card">
      <h2>{agent.name} — {agent.area}</h2>
      <Row label={t.cashDrawer.split(' (')[0]} cls="p-cash" value={agent.cashBalance} max={max} />
      {agent.providers.map((p) => (
        <Row key={p.provider} label={p.provider} cls={CLS[p.provider]} value={p.emoneyBalance} max={max}
          stale={staleProviders.includes(p.provider)} staleText={t.staleFeed} />
      ))}
      <div style={{ marginTop: 10, fontSize: 13, color: 'var(--dim)' }}>
        {agent.providerScopeRestricted ? t.visibleProviderTotal : t.total}: <strong style={{ color: 'var(--text)' }}>{taka(total)}</strong>
      </div>
    </div>
  );
}
