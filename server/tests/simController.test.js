import test from 'node:test';
import assert from 'node:assert/strict';
import { canDriveSimulation } from '../controllers/simController.js';

test('only outlet, field, and all-provider operations roles can drive the shared simulation', () => {
  assert.equal(canDriveSimulation({ role: 'agent' }), true);
  assert.equal(canDriveSimulation({ role: 'field_officer' }), true);
  assert.equal(canDriveSimulation({ role: 'ops', providerScope: ['all'] }), true);
  assert.equal(canDriveSimulation({ role: 'ops', providerScope: ['bKash'] }), false);
  assert.equal(canDriveSimulation({ role: 'risk', providerScope: ['all'] }), false);
  assert.equal(canDriveSimulation({ role: 'management', providerScope: ['all'] }), false);
});
