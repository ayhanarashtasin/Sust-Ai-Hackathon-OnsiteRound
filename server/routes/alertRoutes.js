import { Router } from 'express';
import {
  listAlerts, getAlert, listAssignableUsers, clearAlerts,
  acknowledge, assign, escalate, resolve, addNote, dismiss,
} from '../controllers/alertController.js';
import { requireAuth, requireRole, asyncH } from '../middleware/auth.js';

/*
  Reads are open to every authenticated role (scoped inside the controller).
  Mutations are role-gated at the route AND action-validated in the workflow
  state machine — management is read-only by construction.
*/
const CASE_WORKERS = ['agent', 'field_officer', 'ops', 'risk'];

const router = Router();
router.use(requireAuth);
router.get('/', asyncH(listAlerts));
router.get('/assignable-users', requireRole('field_officer', 'ops', 'risk'), asyncH(listAssignableUsers));
router.get('/:id', asyncH(getAlert));
router.delete('/', requireRole(...CASE_WORKERS), asyncH(clearAlerts)); // demo reset (bulk) — not part of the case workflow
router.post('/:id/acknowledge', requireRole(...CASE_WORKERS), asyncH(acknowledge));
router.post('/:id/assign', requireRole('field_officer', 'ops', 'risk'), asyncH(assign));
router.post('/:id/escalate', requireRole('field_officer', 'ops', 'risk'), asyncH(escalate));
router.post('/:id/resolve', requireRole('field_officer', 'ops', 'risk'), asyncH(resolve));
router.post('/:id/note', requireRole(...CASE_WORKERS), asyncH(addNote));
router.post('/:id/dismiss', requireRole(...CASE_WORKERS), asyncH(dismiss));
export default router;
