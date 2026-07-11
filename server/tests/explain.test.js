import test from 'node:test';
import assert from 'node:assert/strict';
import { generateExplanation } from '../services/explain.js';

test('no OPENAI_API_KEY => template fallback with all trilingual fields (AC-7)', async () => {
  delete process.env.OPENAI_API_KEY;
  const ex = await generateExplanation({
    subtype: 'emoney_depletion',
    severity: 'warning',
    confidence: 0.8,
    evidence: { resource: 'emoney', provider: 'Nagad', burnRatePerMin: 400, windowMin: 30, projectedDepletionAt: new Date(), suggestedTopUp: 20000 },
  });
  assert.equal(ex.explanationSource, 'template');
  for (const k of ['title_en', 'title_bn', 'message_en', 'message_bn', 'message_banglish', 'recommendedNextStep_en', 'recommendedNextStep_bn']) {
    assert.ok(ex[k] && ex[k].length > 0, `missing ${k}`);
  }
  // Quantified next step (brief's illustrative alert style)
  assert.match(ex.recommendedNextStep_en, /20,000/);
});
