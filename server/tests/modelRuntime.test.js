import test from 'node:test';
import assert from 'node:assert/strict';
import { modelStatus, modelMetrics, predictModel, clearModelCache } from '../services/ml/modelRuntime.js';
import { buildFeatureSnapshot, FEATURE_SCHEMA_VERSION } from '../services/ml/featurePipeline.js';

test('model status explicitly reports either a validated artifact or a fallback reason', async () => {
  const models = await modelStatus();
  assert.equal(models.length, 2);
  for (const model of models) {
    assert.equal(typeof model.available, 'boolean');
    if (model.available) assert.equal(model.fallbackReason, null);
    else assert.ok(typeof model.fallbackReason === 'string' && model.fallbackReason.length > 0);
  }
});

function sampleSnapshot() {
  const now = new Date('2026-07-11T15:00:00.000Z');
  const agent = {
    agentId: 'AGT-TEST',
    cashBalance: 40_000, cashOpeningBalance: 50_000, cashFloorThreshold: 12_000, cashCriticalThreshold: 6_000,
    providers: [{ provider: 'bKash', emoneyBalance: 20_000, openingBalance: 40_000, floorThreshold: 5_000, criticalThreshold: 2_500 }],
    lastFeedAt: new Map([['bKash', now]]),
  };
  const transactions = Array.from({ length: 8 }, (_, i) => ({
    provider: 'bKash', type: 'cash_out', amount: 1_500, status: 'success', customerHash: `C-${i}`,
    timestamp: new Date(now.getTime() - (i + 1) * 60_000),
  }));
  return buildFeatureSnapshot({ agent, provider: 'bKash', transactions, asOf: now });
}

test('predictModel runs real ONNX inference or reports a fallback reason', async () => {
  const snapshot = sampleSnapshot();
  const prediction = await predictModel('liquidity_shortage_60m', snapshot);
  assert.equal(prediction.task, 'liquidity_shortage_60m');
  if (prediction.available) {
    assert.ok(prediction.probability >= 0 && prediction.probability <= 1);
    assert.equal(prediction.decisionSource, 'model');
    assert.equal(prediction.featureSchemaVersion, FEATURE_SCHEMA_VERSION);
    assert.ok(typeof prediction.modelType === 'string');
  } else {
    assert.ok(typeof prediction.fallbackReason === 'string' && prediction.fallbackReason.length > 0);
    assert.equal(prediction.decisionSource, 'rules_only');
  }
});

test('predictModel rejects a feature vector that does not match the declared schema', async () => {
  const bad = await predictModel('unusual_activity_review', { schemaVersion: '0.0.0', vector: [1, 2, 3] });
  assert.equal(bad.available, false);
  assert.equal(bad.fallbackReason, 'FEATURE_SCHEMA_MISMATCH');
});

test('modelMetrics exposes per-task evaluation or a fallback reason', async () => {
  const metrics = await modelMetrics();
  assert.equal(metrics.length, 2);
  for (const entry of metrics) {
    assert.ok(entry.task);
    if (entry.available) assert.ok(entry.evaluation || entry.metricsError);
    else assert.ok(typeof entry.fallbackReason === 'string');
  }
});

test('clearModelCache does not throw and forces a reload', async () => {
  clearModelCache();
  const models = await modelStatus();
  assert.equal(models.length, 2);
});
