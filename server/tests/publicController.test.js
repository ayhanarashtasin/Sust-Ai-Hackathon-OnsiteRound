import test from 'node:test';
import assert from 'node:assert/strict';
import { buildPublicServiceStatus } from '../controllers/publicController.js';

test('public service status exposes area and provider state without private alert details', () => {
  const areas = buildPublicServiceStatus(
    [{ area: 'Amberkhana', agentId: 'AGT-001' }],
    [
      { area: 'Amberkhana', provider: 'bKash', severity: 'warning', status: 'new', alertId: 'ALT-1' },
      { area: 'Amberkhana', provider: null, severity: 'critical', status: 'acknowledged', alertId: 'ALT-2' },
      { area: 'Amberkhana', provider: 'Rocket', severity: 'critical', status: 'resolved', alertId: 'ALT-3' },
    ],
  );

  assert.deepEqual(areas, [{
    area: 'Amberkhana',
    providers: [
      { provider: 'bKash', status: 'critical' },
      { provider: 'Nagad', status: 'critical' },
      { provider: 'Rocket', status: 'critical' },
    ],
  }]);
  assert.equal(JSON.stringify(areas).includes('AGT-'), false);
  assert.equal(JSON.stringify(areas).includes('ALT-'), false);
});
