import test from 'node:test';
import assert from 'node:assert/strict';
import { combineDecisions } from '../services/ml/hybridDecision.js';

test('missing model artifact never hides a critical deterministic safety rule', () => {
  const rules = {
    hardSafety: [{ id: 'cash_below_critical', severity: 'critical' }],
    anomalyEvidence: [],
    dataQuality: [],
    triggered: [{ id: 'cash_below_critical', severity: 'critical' }],
    hasCriticalOverride: true,
  };
  const unavailable = { available: false, fallbackReason: 'MODEL_ARTIFACT_MISSING' };
  const decisions = combineDecisions({
    liquidityModel: unavailable,
    anomalyModel: unavailable,
    rules,
    features: { missing_feature_pct: 0 },
  });
  assert.equal(decisions.liquidity.alert, true);
  assert.equal(decisions.liquidity.mode, 'critical_override');
  assert.equal(decisions.liquidity.decisionSource, 'rules_only');
  assert.equal(decisions.liquidity.riskScore, 0.98);
  assert.equal(decisions.liquidity.fallbackReason, 'MODEL_ARTIFACT_MISSING');
});
