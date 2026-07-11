import test from 'node:test';
import assert from 'node:assert/strict';
import { validateAction, canTransition, roleCanAct, ESCALATION_TARGETS, ASSIGNABLE_ROLES } from '../services/caseWorkflow.js';

/*
  Case-lifecycle guarantees (Scenario D / auditability):
  illegal transitions and unauthorized roles are rejected BEFORE any write.
*/

test('a resolved case cannot be acknowledged again', () => {
  const v = validateAction({ action: 'acknowledge', role: 'ops', currentStatus: 'resolved' });
  assert.equal(v.ok, false);
  assert.equal(v.code, 409);
});

test('a dismissed case cannot be resolved or escalated', () => {
  assert.equal(validateAction({ action: 'resolve', role: 'ops', currentStatus: 'dismissed' }).ok, false);
  assert.equal(validateAction({ action: 'escalate', role: 'ops', currentStatus: 'dismissed' }).ok, false);
});

test('dismiss is only allowed early (new/acknowledged) — not mid-workflow', () => {
  assert.equal(canTransition('dismiss', 'new'), true);
  assert.equal(canTransition('dismiss', 'acknowledged'), true);
  assert.equal(canTransition('dismiss', 'in_progress'), false);
  assert.equal(canTransition('dismiss', 'escalated'), false);
  assert.equal(canTransition('dismiss', 'resolved'), false);
});

test('management is read-only: every mutating action is denied', () => {
  for (const action of ['acknowledge', 'assign', 'escalate', 'resolve', 'note', 'dismiss']) {
    const v = validateAction({ action, role: 'management', currentStatus: 'new' });
    assert.equal(v.ok, false, `management should not be able to ${action}`);
    assert.equal(v.code, 403);
  }
});

test('agents can acknowledge and note but not assign/escalate/resolve', () => {
  assert.equal(roleCanAct('acknowledge', 'agent'), true);
  assert.equal(roleCanAct('note', 'agent'), true);
  assert.equal(roleCanAct('assign', 'agent'), false);
  assert.equal(roleCanAct('escalate', 'agent'), false);
  assert.equal(roleCanAct('resolve', 'agent'), false);
});

test('escalation targets are a fixed allow-list — arbitrary roles rejected', () => {
  const bad = validateAction({ action: 'escalate', role: 'ops', currentStatus: 'acknowledged', targetRole: 'management' });
  assert.equal(bad.ok, false);
  assert.equal(bad.code, 400);
  const good = validateAction({ action: 'escalate', role: 'ops', currentStatus: 'acknowledged', targetRole: 'risk' });
  assert.equal(good.ok, true);
  assert.ok(ESCALATION_TARGETS.includes('risk'));
});

test('the happy path walks: new → acknowledged → in_progress → escalated → resolved', () => {
  assert.equal(validateAction({ action: 'acknowledge', role: 'field_officer', currentStatus: 'new' }).ok, true);
  assert.equal(validateAction({ action: 'assign', role: 'field_officer', currentStatus: 'acknowledged' }).ok, true);
  assert.equal(validateAction({ action: 'escalate', role: 'ops', currentStatus: 'in_progress', targetRole: 'risk' }).ok, true);
  assert.equal(validateAction({ action: 'resolve', role: 'risk', currentStatus: 'escalated' }).ok, true);
});

test('post-resolution notes are allowed (review log), other mutations are not', () => {
  assert.equal(validateAction({ action: 'note', role: 'risk', currentStatus: 'resolved' }).ok, true);
  assert.equal(validateAction({ action: 'assign', role: 'risk', currentStatus: 'resolved' }).ok, false);
});

test('assignment targets exclude agents and management', () => {
  assert.deepEqual([...ASSIGNABLE_ROLES].sort(), ['field_officer', 'ops', 'risk']);
});
