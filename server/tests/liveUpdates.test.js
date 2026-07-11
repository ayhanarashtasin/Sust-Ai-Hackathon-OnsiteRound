import test from 'node:test';
import assert from 'node:assert/strict';
import { liveUpdates, notifyDataUpdate } from '../services/liveUpdates.js';

test('live updates emit an invalidation signal without a data payload', () => {
  let received = 'not-called';
  const listener = (payload) => { received = payload; };
  liveUpdates.once('data-updated', listener);

  notifyDataUpdate();

  assert.equal(received, undefined);
});
