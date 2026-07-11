const money = (value) => `BDT ${Math.round(Number(value || 0)).toLocaleString('en-IN')}`;

export function readableEvidence(features, provider) {
  return [
    { label: 'Physical cash', value: money(features.cash_current) },
    { label: `${provider} electronic balance`, value: money(features.provider_balance) },
    { label: '30-minute cash burn rate', value: `${money(features.cash_burn_rate_30m)}/min` },
    { label: 'Velocity versus baseline', value: `${features.velocity_ratio.toFixed(1)}x` },
    { label: 'Provider feed age', value: `${Math.round(features.feed_delay_min)} min` },
  ];
}

export function dataFreshness(features, rules) {
  const dataIssue = rules.dataQuality.length > 0;
  return {
    status: dataIssue ? 'requires_review' : 'fresh',
    ageMinutes: Math.round(features.feed_delay_min),
    note: dataIssue ? 'Data-quality issue reduces confidence and suppresses precise recommendations.' : 'Provider feed is within the configured freshness limit.',
  };
}
