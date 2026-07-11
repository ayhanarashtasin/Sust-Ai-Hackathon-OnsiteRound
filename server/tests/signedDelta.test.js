import test from 'node:test';
import assert from 'node:assert/strict';
import { signedDelta } from '../services/signedDelta.js';

const txn = (type) => ({ type, amount: 1000, status: 'success' });

test('all supported transaction types preserve their documented balance direction', () => {
  assert.deepEqual(signedDelta(txn('cash_out')), { cash: -1000, emoney: 1000 });
  for (const type of ['cash_in', 'send_money', 'payment']) {
    assert.deepEqual(signedDelta(txn(type)), { cash: 1000, emoney: -1000 });
  }
  assert.deepEqual(signedDelta(txn('b2b_topup')), { cash: 0, emoney: 1000 });
  assert.deepEqual(signedDelta(txn('unsupported')), { cash: 0, emoney: 0 });
});
