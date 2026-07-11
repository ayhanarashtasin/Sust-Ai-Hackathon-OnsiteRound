import test from 'node:test';
import assert from 'node:assert/strict';
import { rebuildSeededState } from '../services/demoReset.js';

const agent = {
  cashOpeningBalance: 10000,
  providers: [
    { provider: 'bKash', openingBalance: 5000 },
    { provider: 'Nagad', openingBalance: 7000 },
  ],
};

test('demo reset rebuilds balances and transaction snapshots from seeded history', () => {
  const now = new Date('2026-07-11T12:00:00.000Z');
  const txns = [
    { provider: 'bKash', type: 'cash_out', amount: 1000, status: 'success', timestamp: new Date('2026-07-11T08:00:00.000Z') },
    { provider: 'Nagad', type: 'cash_in', amount: 500, status: 'success', timestamp: new Date('2026-07-11T09:00:00.000Z') },
    { provider: 'bKash', type: 'cash_out', amount: 900, status: 'failed', timestamp: new Date('2026-07-11T10:00:00.000Z') },
  ];

  const result = rebuildSeededState(agent, txns, now);

  assert.equal(result.cashBalance, 9500);
  assert.deepEqual(result.providerBalances, { bKash: 6000, Nagad: 6500 });
  assert.equal(result.transactions.at(-1).timestamp.toISOString(), '2026-07-11T11:30:00.000Z');
  assert.deepEqual(result.transactions[0].balanceAfter, { cash: 9000, emoney: 6000 });
  assert.deepEqual(result.transactions[1].balanceAfter, { cash: 9500, emoney: 6500 });
  assert.deepEqual(result.transactions[2].balanceAfter, { cash: 9500, emoney: 6000 });
});

test('demo reset with no seeded history restores opening balances', () => {
  const result = rebuildSeededState(agent, [], new Date());

  assert.equal(result.cashBalance, 10000);
  assert.deepEqual(result.providerBalances, { bKash: 5000, Nagad: 7000 });
  assert.deepEqual(result.transactions, []);
});
