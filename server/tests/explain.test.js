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

test('liquidity templates withhold quantified advice when data is unreliable', async () => {
  delete process.env.OPENAI_API_KEY;
  const ex = await generateExplanation({
    subtype: 'emoney_depletion',
    severity: 'warning',
    confidence: 0.4,
    evidence: {
      resource: 'emoney', provider: 'Rocket', burnRatePerMin: 400, windowMin: 30,
      projectedDepletionAt: new Date(), suggestedTopUp: 0, recommendationSuppressed: true,
    },
  });
  assert.match(ex.recommendedNextStep_en, /no top-up amount is recommended/i);
  assert.equal(ex.explanationSource, 'template');
});

test('liquidity templates avoid a top-up when current headroom is sufficient', async () => {
  delete process.env.OPENAI_API_KEY;
  const ex = await generateExplanation({
    subtype: 'cash_depletion',
    confidence: 0.8,
    evidence: {
      resource: 'cash', burnRatePerMin: 10, windowMin: 30,
      projectedDepletionAt: new Date(), suggestedTopUp: 0,
    },
  });
  assert.match(ex.recommendedNextStep_en, /monitor closely/i);
});

test('repeated-amount alerts name the exact pattern and role-safe review action', async () => {
  delete process.env.OPENAI_API_KEY;
  const ex = await generateExplanation({
    subtype: 'repeated_amount',
    confidence: 0.93,
    evidence: {
      provider: 'bKash', amount: 9883, amountMin: 9800, amountMax: 10000,
      repeatCount: 6, distinctAccounts: 3, windowMinutes: 30,
    },
  });

  assert.match(ex.message_en, /6 cash-outs between .*9,800.*10,000.*only 3 account.*30 minutes/i);
  assert.match(ex.recommendedNextStep_en, /6 listed transactions with provider operations or risk staff/i);
});
