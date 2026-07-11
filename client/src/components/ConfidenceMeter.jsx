import { useLang } from '../i18n/index.js';

/* Uncertainty is always visible (AC-6): dims + yellows below 0.6 */
export default function ConfidenceMeter({ value = 0 }) {
  const { t } = useLang();
  const pct = Math.round(value * 100);
  return (
    <span className="conf-meter" title={`${t.confidence}: ${pct}%`}>
      <span className="conf-track"><span className={`conf-fill ${value < 0.6 ? 'low' : ''}`} style={{ width: `${pct}%`, display: 'block' }} /></span>
      {pct}%
    </span>
  );
}
