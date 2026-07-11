import test from 'node:test';
import assert from 'node:assert/strict';
import { modelStatus } from '../services/ml/modelRuntime.js';

test('model status explicitly reports either a validated artifact or a fallback reason', async () => {
  const models = await modelStatus();
  assert.equal(models.length, 2);
  for (const model of models) {
    assert.equal(typeof model.available, 'boolean');
    if (model.available) assert.equal(model.fallbackReason, null);
    else assert.ok(typeof model.fallbackReason === 'string' && model.fallbackReason.length > 0);
  }
});
