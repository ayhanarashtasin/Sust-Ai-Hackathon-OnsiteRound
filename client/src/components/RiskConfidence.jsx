const unavailable = 'Not available';

function percentage(value) {
  if (value === '' || value == null) return unavailable;
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0 || number > 1) return unavailable;
  return `${Math.round(number * 100)}%`;
}

function bandClass(band) {
  const value = typeof band === 'string' ? band.toLowerCase() : '';
  if (value === 'critical' || value === 'high') return 'critical';
  if (value === 'warning' || value === 'elevated' || value === 'medium') return 'warning';
  return 'status';
}

export default function RiskConfidence({
  risk,
  confidence,
  riskBand,
  reducedConfidenceReason,
}) {
  const band = typeof riskBand === 'string' && riskBand.trim()
    ? riskBand.trim()
    : unavailable;
  const reason = typeof reducedConfidenceReason === 'string' && reducedConfidenceReason.trim()
    ? reducedConfidenceReason.trim()
    : unavailable;

  return (
    <section className="card" aria-label="Risk and confidence">
      <h2>Risk and confidence</h2>
      <dl className="explanation-grid">
        <div className="explanation-row">
          <dt>Risk</dt>
          <dd>{percentage(risk)}</dd>
        </div>
        <div className="explanation-row">
          <dt>Confidence</dt>
          <dd>{percentage(confidence)}</dd>
        </div>
        <div className="explanation-row">
          <dt>Risk band</dt>
          <dd><span className={`chip ${bandClass(riskBand)}`}>{band}</span></dd>
        </div>
        <div className="explanation-row">
          <dt>Reduced-confidence reason</dt>
          <dd>{reason}</dd>
        </div>
      </dl>
    </section>
  );
}
