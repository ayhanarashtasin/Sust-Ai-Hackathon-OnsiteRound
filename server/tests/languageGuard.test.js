import test from 'node:test';
import assert from 'node:assert/strict';
import { isSafeLanguage, assertSafeLanguage, findBannedLanguage } from '../services/languageGuard.js';
import { templateExplanation } from '../services/explain.js';

test('banned English words are caught (AC-4)', () => {
  assert.equal(isSafeLanguage('This transaction is fraud'), false);
  assert.equal(isSafeLanguage('The agent is GUILTY of theft'), false);
  assert.equal(isSafeLanguage('Fraudulent activity detected'), false);
  assert.equal(assertSafeLanguage('customer is a scammer'), null);
});

test('banned Bangla words are caught', () => {
  assert.equal(isSafeLanguage('এটি জালিয়াতি হতে পারে'), false);
  assert.equal(isSafeLanguage('এজেন্ট দোষী'), false);
  assert.deepEqual(findBannedLanguage('প্রতারণা সন্দেহ হচ্ছে').length > 0, true);
});

test('careful language passes', () => {
  assert.equal(isSafeLanguage('This pattern is unusual and requires review'), true);
  assert.equal(isSafeLanguage('গত ১২ মিনিটে স্বাভাবিকের তুলনায় অনেক বেশি ক্যাশ-আউট হয়েছে। পর্যালোচনা প্রয়োজন।'), true);
  assert.equal(assertSafeLanguage('requires review'), 'requires review');
});

test('every template output is guard-safe for every subtype', () => {
  const cases = [
    { subtype: 'cash_depletion', evidence: { resource: 'cash', burnRatePerMin: 500, windowMin: 30, projectedDepletionAt: new Date(), suggestedTopUp: 20000 } },
    { subtype: 'emoney_depletion', evidence: { resource: 'emoney', provider: 'Nagad', burnRatePerMin: 300, windowMin: 30, projectedDepletionAt: new Date(), suggestedTopUp: 10000 } },
    { subtype: 'velocity_spike', evidence: { provider: 'bKash', bucketMinutes: 5, bucketCount: 12, baselineMean: 3, baselineStd: 1.4, zScore: 6.4 } },
    { subtype: 'demand_surge', evidence: { provider: 'Rocket', bucketMinutes: 5, bucketCount: 12, baselineMean: 3, distinctAccounts: 10 } },
    { subtype: 'repeated_amount', evidence: { provider: 'bKash', amount: 9800, repeatCount: 6, distinctAccounts: 2, windowMinutes: 30 } },
    { subtype: 'stale_feed', evidence: { provider: 'Rocket', ageMinutes: 15, thresholdMinutes: 10 } },
    { subtype: 'missing_feed', evidence: { provider: 'Rocket' } },
    { subtype: 'balance_mismatch', evidence: { provider: 'Rocket', expected: 50000, actual: 57777, deltaAbs: 7777, tolerance: 1 } },
    { subtype: 'unknown', evidence: {} },
  ];
  for (const c of cases) {
    const ex = templateExplanation({ ...c, confidence: 0.7 });
    for (const [k, v] of Object.entries(ex)) {
      if (typeof v === 'string') assert.equal(isSafeLanguage(v), true, `${c.subtype}.${k} failed guard: ${v}`);
    }
  }
});
