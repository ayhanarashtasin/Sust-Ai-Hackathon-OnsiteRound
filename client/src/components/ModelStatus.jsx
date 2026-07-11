const unavailable = 'Not available';

function text(value) {
  if (typeof value === 'string') return value.trim() || unavailable;
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return unavailable;
}

export default function ModelStatus({ available, type, version, name, fallbackReason }) {
  if (available === false) {
    const reason = typeof fallbackReason === 'string' && fallbackReason.trim()
      ? fallbackReason.trim()
      : 'Model unavailable; no model output is being shown.';

    return (
      <section className="card" aria-label="Model status">
        <h2>Model status</h2>
        <div className="dq-banner"><strong>Rules-only fallback</strong></div>
        <div className="review-note">{reason}</div>
      </section>
    );
  }

  if (available !== true) {
    return (
      <section className="card" aria-label="Model status">
        <h2>Model status</h2>
        <div className="review-note">Model availability is not reported.</div>
      </section>
    );
  }

  return (
    <section className="card" aria-label="Model status">
      <h2>Model status</h2>
      <dl className="explanation-grid">
        <div className="explanation-row">
          <dt>Availability</dt>
          <dd><span className="chip status">Available</span></dd>
        </div>
        {name && (
          <div className="explanation-row">
            <dt>Model</dt>
            <dd>{text(name)}</dd>
          </div>
        )}
        <div className="explanation-row">
          <dt>Type</dt>
          <dd>{text(type)}</dd>
        </div>
        <div className="explanation-row">
          <dt>Version</dt>
          <dd>{text(version)}</dd>
        </div>
      </dl>
    </section>
  );
}
