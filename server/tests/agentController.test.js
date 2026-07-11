import test from 'node:test';
import assert from 'node:assert/strict';
import { buildManagementOverview } from '../controllers/agentController.js';

test('management overview exposes area readiness without outlet identities', () => {
  const overview = buildManagementOverview(
    [{ area: 'Amberkhana' }, { area: 'Amberkhana' }, { area: 'Zindabazar' }],
    [
      { area: 'Amberkhana', subtype: 'repeated_amount', severity: 'critical', status: 'new' },
      { area: 'Amberkhana', subtype: 'repeated_amount', severity: 'warning', status: 'resolved' },
      { area: 'Zindabazar', subtype: 'stale_feed', severity: 'warning', status: 'acknowledged' },
    ],
  );

  assert.deepEqual(overview.areas, [
    { area: 'Amberkhana', agentCount: 2, openAlerts: 1, criticalAlerts: 1, readiness: 'critical' },
    { area: 'Zindabazar', agentCount: 1, openAlerts: 1, criticalAlerts: 0, readiness: 'attention' },
  ]);
  assert.deepEqual(overview.recurring, [{ area: 'Amberkhana', subtype: 'repeated_amount', count: 2 }]);
});
