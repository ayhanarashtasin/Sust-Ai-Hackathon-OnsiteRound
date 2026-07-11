import test from 'node:test';
import assert from 'node:assert/strict';
import { readableEvidence, dataFreshness } from '../services/ml/evidenceMapper.js';

const features = {
  cash_current: 72_200,
  provider_balance: 58_200,
  cash_burn_rate_30m: 350,
  velocity_ratio: 2.4,
  feed_delay_min: 3.6,
};

test('readableEvidence renders the five decision inputs as human-readable strings', () => {
  const rows = readableEvidence(features, 'bKash');
  assert.equal(rows.length, 5);
  const labels = rows.map((row) => row.label);
  assert.ok(labels.includes('Physical cash'));
  assert.ok(labels.includes('bKash electronic balance'));
  assert.match(rows.find((row) => row.label === 'Physical cash').value, /72,200/);
  assert.match(rows.find((row) => row.label === 'Velocity versus baseline').value, /2\.4x/);
  assert.match(rows.find((row) => row.label === 'Provider feed age').value, /4 min/); // rounded
});

test('dataFreshness reports fresh when no data-quality rules triggered', () => {
  const out = dataFreshness(features, { dataQuality: [] });
  assert.equal(out.status, 'fresh');
  assert.equal(out.ageMinutes, 4);
  assert.match(out.note, /within the configured freshness limit/);
});

test('dataFreshness flags requires_review and explains the reduced confidence', () => {
  const out = dataFreshness(features, { dataQuality: [{ id: 'provider_feed_stale' }] });
  assert.equal(out.status, 'requires_review');
  assert.match(out.note, /reduces confidence/);
});
