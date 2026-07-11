import { useLang } from '../i18n/index.js';

export default function AlertExplanation({ alert, id }) {
  const { t, lang } = useLang();
  const evidence = alert.evidence || {};
  const locale = lang === 'bn' ? 'bn-BD' : 'en-IN';
  const number = (value) => value == null ? t.notAvailable : Number(value).toLocaleString(locale);
  const money = (value) => value == null ? t.notAvailable : `৳${number(value)}`;
  const dateTime = (value) => value ? new Date(value).toLocaleString(locale, { dateStyle: 'medium', timeStyle: 'short' }) : t.notAvailable;
  const percent = (value) => value == null ? t.notAvailable : `${Math.round(Number(value) * 100)}%`;
  const rows = [];
  let summary = t.explanationUnavailable;
  const normalReasonLabels = {
    'Pre-Eid cash-out demand': t.normalEidDemand,
    'Salary-day spike': t.normalSalarySpike,
    'Provider feed delay or data-quality issue': t.normalFeedIssue,
  };

  const add = (label, value) => rows.push({ label, value });

  switch (alert.subtype) {
    case 'cash_depletion':
    case 'emoney_depletion': {
      summary = t.reasonLiquidity;
      add(t.resource, evidence.resource === 'cash' ? t.physicalCash : `${evidence.provider || alert.provider || ''} ${t.emoney}`.trim());
      add(t.currentBalance, money(evidence.currentBalance));
      add(t.safeFloor, money(evidence.floorThreshold));
      add(t.recentBurnRate, `${money(evidence.burnRatePerMin)} / ${t.minute}`);
      add(t.analysisWindow, `${number(evidence.windowMin)} ${t.minutes}`);
      add(t.observedTransactions, number(evidence.sampleSize));
      add(t.projectedDepletion, dateTime(evidence.projectedDepletionAt));
      const threshold = alert.severity === 'critical'
        ? evidence.criticalThresholdMin ?? 30
        : evidence.warningThresholdMin ?? 120;
      add(t.triggerThreshold, `${number(evidence.timeToDepletionMin)} ${t.minutes} < ${number(threshold)} ${t.minutes}`);
      break;
    }
    case 'velocity_spike':
      summary = t.reasonVelocity;
      add(t.observedCashouts, `${number(evidence.bucketCount)} / ${number(evidence.bucketMinutes)} ${t.minutes}`);
      add(t.typicalCashouts, number(evidence.baselineMean));
      add(t.zScore, number(evidence.zScore));
      add(t.triggerThreshold, `${t.zScore} > ${number(evidence.thresholdZScore ?? 3)}, ${t.observedCashouts} ≥ ${number(evidence.minimumBucketCount ?? 6)}`);
      break;
    case 'repeated_amount':
      summary = t.reasonRepeated;
      add(t.repeatedAmount, money(evidence.amount));
      add(t.repeatCount, `${number(evidence.repeatCount)} / ${number(evidence.windowMinutes)} ${t.minutes}`);
      add(t.distinctAccounts, number(evidence.distinctAccounts));
      add(t.triggerThreshold, `${t.repeatCount} ≥ ${number(evidence.minimumRepeatCount ?? 5)}, ${t.distinctAccounts} ≤ ${number(evidence.maximumDistinctAccounts ?? 3)}`);
      break;
    case 'stale_feed':
      summary = t.reasonStale;
      add(t.provider, evidence.provider || alert.provider || t.notAvailable);
      add(t.lastFeedUpdate, dateTime(evidence.lastFeedAt));
      add(t.feedAge, `${number(evidence.ageMinutes)} ${t.minutes}`);
      add(t.triggerThreshold, `${number(evidence.ageMinutes)} > ${number(evidence.thresholdMinutes)} ${t.minutes}`);
      break;
    case 'balance_mismatch':
      summary = t.reasonMismatch;
      add(t.provider, evidence.provider || alert.provider || t.notAvailable);
      add(t.expectedBalance, money(evidence.expected));
      add(t.reportedBalance, money(evidence.actual));
      add(t.difference, money(evidence.deltaAbs));
      add(t.triggerThreshold, `${money(evidence.deltaAbs)} > ${money(evidence.tolerance)}`);
      break;
    default:
      break;
  }

  add(t.confidence, percent(alert.confidence));

  return (
    <section className="alert-explanation" id={id} aria-label={t.whyThisAlert}>
      <div className="explanation-summary">{summary}</div>
      <dl className="explanation-grid">
        {rows.map((row, index) => (
          <div className="explanation-row" key={`${row.label}-${index}`}>
            <dt>{row.label}</dt>
            <dd>{row.value}</dd>
          </div>
        ))}
      </dl>
      {alert.possibleNormalReasons?.length > 0 && (
        <div className="normal-reasons">
          <strong>{t.possibleReasons}</strong>
          <ul>{alert.possibleNormalReasons.map((reason) => <li key={reason}>{normalReasonLabels[reason] || reason}</li>)}</ul>
        </div>
      )}
      <div className="review-note">{t.requiresReview}</div>
    </section>
  );
}
