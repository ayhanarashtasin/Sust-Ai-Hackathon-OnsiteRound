import test from 'node:test';
import assert from 'node:assert/strict';
import { generateExplanation } from '../services/explain.js';

/*
  Exercises the optional OpenAI path in explain.js by stubbing global fetch —
  no network, no real key. Isolated in its own file (own process) so the
  OPENAI_API_KEY env change never leaks into other suites.
*/

const finding = { subtype: 'velocity_spike', severity: 'warning', confidence: 0.7, evidence: { provider: 'bKash', bucketMinutes: 5, bucketCount: 12, baselineMean: 3, zScore: 6, distinctAccounts: 3 } };

function stubFetch(payload, ok = true) {
  globalThis.fetch = async () => ({ ok, json: async () => payload });
}

test('safe OpenAI output is used and tagged explanationSource=openai', async () => {
  const original = globalThis.fetch;
  process.env.OPENAI_API_KEY = 'test-key';
  try {
    stubFetch({ choices: [{ message: { content: JSON.stringify({
      message_en: 'Unusual activity — requires review.',
      message_bn: 'অস্বাভাবিক কার্যক্রম — পর্যালোচনা প্রয়োজন।',
      message_banglish: 'Unusual activity — review dorkar.',
    }) } }] });
    const out = await generateExplanation(finding);
    assert.equal(out.explanationSource, 'openai');
    assert.match(out.message_en, /requires review/i);
    // Titles/next steps stay templated (deterministic, quantified)
    assert.ok(out.title_en && out.recommendedNextStep_en);
  } finally {
    globalThis.fetch = original;
    delete process.env.OPENAI_API_KEY;
  }
});

test('OpenAI output containing banned language is rejected and falls back to the template', async () => {
  const original = globalThis.fetch;
  process.env.OPENAI_API_KEY = 'test-key';
  try {
    stubFetch({ choices: [{ message: { content: JSON.stringify({
      message_en: 'This is fraud and the agent is a criminal.',
      message_bn: 'ok', message_banglish: 'ok',
    }) } }] });
    const out = await generateExplanation(finding);
    assert.equal(out.explanationSource, 'template');
  } finally {
    globalThis.fetch = original;
    delete process.env.OPENAI_API_KEY;
  }
});

test('a non-OK OpenAI response falls back to the template', async () => {
  const original = globalThis.fetch;
  process.env.OPENAI_API_KEY = 'test-key';
  try {
    stubFetch({}, false);
    const out = await generateExplanation({ subtype: 'stale_feed', severity: 'warning', confidence: 0.8, evidence: { provider: 'Rocket', ageMinutes: 22, thresholdMinutes: 10 } });
    assert.equal(out.explanationSource, 'template');
  } finally {
    globalThis.fetch = original;
    delete process.env.OPENAI_API_KEY;
  }
});
