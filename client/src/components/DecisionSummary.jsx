const unavailable = 'Not available';

function scalar(value) {
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  return '';
}

function describedValue(value) {
  if (value == null) return '';
  if (typeof value !== 'object' || Array.isArray(value)) return scalar(value);

  const label = scalar(value.label || value.name);
  const detail = scalar(value.value ?? value.detail ?? value.text);
  const unit = scalar(value.unit);
  if (label && detail) return `${label}: ${detail}${unit ? ` ${unit}` : ''}`;
  return label || (detail ? `${detail}${unit ? ` ${unit}` : ''}` : '');
}

function evidenceText(item) {
  if (item == null || typeof item !== 'object' || Array.isArray(item)) {
    return scalar(item);
  }
  return scalar(item.text || item.summary) || describedValue(item);
}

function ruleText(rule) {
  if (rule == null || typeof rule !== 'object' || Array.isArray(rule)) {
    return scalar(rule);
  }
  const name = scalar(rule.name || rule.rule);
  const reason = scalar(rule.reason || rule.description);
  if (name && reason) return `${name}: ${reason}`;
  return reason || name;
}

function sourceText(source) {
  if (typeof source === 'string') return source.trim() || unavailable;
  if (!source || typeof source !== 'object') return unavailable;

  const type = scalar(source.type).toLowerCase();
  const label = scalar(source.label || source.name);
  const version = scalar(source.version);
  const typeLabels = { model: 'Model', rules: 'Rules', fallback: 'Fallback' };
  const parts = [typeLabels[type] || scalar(source.type), label, version && `v${version}`].filter(Boolean);
  return parts.join(' / ') || unavailable;
}

function validDateTime(value) {
  if (!value) return '';
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' });
}

function freshnessText(freshness) {
  if (typeof freshness === 'string') return freshness.trim() || unavailable;
  if (!freshness || typeof freshness !== 'object') return unavailable;

  const status = scalar(freshness.status).replaceAll('_', ' ');
  const updatedAt = validDateTime(freshness.updatedAt || freshness.lastUpdatedAt);
  const age = Number(freshness.ageMinutes);
  const ageText = Number.isFinite(age) && age >= 0 ? `${age} min old` : '';
  const note = scalar(freshness.note);
  return [status, updatedAt && `updated ${updatedAt}`, ageText, note].filter(Boolean).join(' / ') || unavailable;
}

function horizonText(horizon) {
  if (!horizon || typeof horizon !== 'object' || horizon.reliable !== true) return '';
  return describedValue({
    label: horizon.label,
    value: horizon.value ?? horizon.text,
    unit: horizon.unit,
  });
}

export default function DecisionSummary({
  pressure,
  horizon,
  source,
  evidence = [],
  triggeredRules = [],
  dataFreshness,
  safeNextStep,
}) {
  const provider = scalar(pressure?.provider);
  const resource = scalar(pressure?.resource || pressure?.task?.replaceAll('_', ' '));
  const mainPressure = [provider, resource].filter(Boolean).join(' / ') || unavailable;
  const reliableHorizon = horizonText(horizon);
  const visibleEvidence = (Array.isArray(evidence) ? evidence : [])
    .map(evidenceText)
    .filter(Boolean)
    .slice(0, 5);
  const ruleReasons = (Array.isArray(triggeredRules) ? triggeredRules : [])
    .map(ruleText)
    .filter(Boolean);
  const nextStep = scalar(safeNextStep) || unavailable;

  return (
    <section className="card" aria-label="Decision summary">
      <h2>Decision summary</h2>
      <dl className="explanation-grid">
        <div className="explanation-row">
          <dt>Main pressure</dt>
          <dd>{mainPressure}</dd>
        </div>
        {reliableHorizon && (
          <div className="explanation-row">
            <dt>Reliable horizon</dt>
            <dd>{reliableHorizon}</dd>
          </div>
        )}
        <div className="explanation-row">
          <dt>Decision source</dt>
          <dd>{sourceText(source)}</dd>
        </div>
        <div className="explanation-row">
          <dt>Data freshness</dt>
          <dd>{freshnessText(dataFreshness)}</dd>
        </div>
      </dl>

      <div className="normal-reasons">
        <strong>Supporting evidence</strong>
        {visibleEvidence.length > 0
          ? <ul>{visibleEvidence.map((item, index) => <li key={`${item}-${index}`}>{item}</li>)}</ul>
          : <div className="review-note">No supporting evidence available.</div>}
      </div>

      <div className="normal-reasons">
        <strong>Triggered rule reasons</strong>
        {ruleReasons.length > 0
          ? <ul>{ruleReasons.map((reason, index) => <li key={`${reason}-${index}`}>{reason}</li>)}</ul>
          : <div className="review-note">No triggered rule reasons available.</div>}
      </div>

      <div className="next-step"><strong>Safe next step:</strong> {nextStep}</div>
      <div className="review-note">Decision support only. Review the evidence before acting.</div>
    </section>
  );
}
