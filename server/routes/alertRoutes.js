import { Router } from 'express';
import { listAlerts, getAlert, deleteAlert, clearAlerts, acknowledge, assign, escalate, resolve, addNote } from '../controllers/alertController.js';
import { requireAuth, requireRole } from '../middleware/auth.js';

const router = Router();
router.use(requireAuth);
router.get('/', listAlerts);
router.get('/:id', getAlert);
router.delete('/', requireRole('agent', 'field_officer', 'ops', 'risk'), clearAlerts); // demo reset (bulk)
router.delete('/:id', requireRole('agent', 'field_officer', 'ops', 'risk'), deleteAlert);
router.post('/:id/acknowledge', acknowledge);
router.post('/:id/assign', assign);
router.post('/:id/escalate', escalate);
router.post('/:id/resolve', resolve);
router.post('/:id/note', addNote);
export default router;
