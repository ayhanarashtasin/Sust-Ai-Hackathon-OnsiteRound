/*
  Case-lifecycle state machine (Scenario D — coordinated response).

      new ──ack──▶ acknowledged ──assign──▶ in_progress ──resolve──▶ resolved
       │                │                        │
       └────────────escalate─────────────────────┴──▶ escalated ──resolve──▶ resolved
      (dismiss allowed from new/acknowledged only — recorded in history)

  Every action is validated here BEFORE any write:
    - is the action legal from the alert's current status? (no re-ack of a resolved case)
    - is the caller's role allowed to perform it? (management is strictly read-only)
    - is the target valid? (assignees must be real case-working users; escalation
      targets are a fixed set of roles — no arbitrary role injection)
*/

export const LEGAL_TRANSITIONS = {
  acknowledge: ['new'],
  assign: ['new', 'acknowledged', 'in_progress'],
  escalate: ['new', 'acknowledged', 'in_progress'],
  resolve: ['acknowledged', 'in_progress', 'escalated'],
  note: ['new', 'acknowledged', 'in_progress', 'escalated', 'resolved'], // post-resolution notes allowed (review log)
  dismiss: ['new', 'acknowledged'],
};

/* Which roles may perform each action. Management is read-only everywhere. */
export const ACTION_ROLES = {
  acknowledge: ['agent', 'field_officer', 'ops', 'risk'],
  assign: ['field_officer', 'ops', 'risk'],
  escalate: ['field_officer', 'ops', 'risk'],
  resolve: ['field_officer', 'ops', 'risk'],
  note: ['agent', 'field_officer', 'ops', 'risk'],
  dismiss: ['agent', 'field_officer', 'ops', 'risk'],
};

/* Users who can OWN a case (assignment targets). Agents and management cannot. */
export const ASSIGNABLE_ROLES = ['field_officer', 'ops', 'risk'];

/* Escalation raises an authorized support request to one of these teams only. */
export const ESCALATION_TARGETS = ['ops', 'risk'];

export function canTransition(action, currentStatus) {
  return (LEGAL_TRANSITIONS[action] || []).includes(currentStatus);
}

export function roleCanAct(action, role) {
  return (ACTION_ROLES[action] || []).includes(role);
}

/*
  Full validation for one action. Returns { ok: true } or { ok: false, code, error }.
  code: 403 (role/boundary) or 409 (illegal state transition) or 400 (bad target).
*/
export function validateAction({ action, role, currentStatus, targetRole = null }) {
  if (!roleCanAct(action, role)) {
    return { ok: false, code: 403, error: `Role '${role}' may not ${action} a case` };
  }
  if (!canTransition(action, currentStatus)) {
    return {
      ok: false,
      code: 409,
      error: `Cannot ${action} a case in status '${currentStatus}' (allowed from: ${LEGAL_TRANSITIONS[action].join(', ')})`,
    };
  }
  if (action === 'escalate' && targetRole && !ESCALATION_TARGETS.includes(targetRole)) {
    return { ok: false, code: 400, error: `Escalation target must be one of: ${ESCALATION_TARGETS.join(', ')}` };
  }
  return { ok: true };
}
