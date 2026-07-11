import { Router } from 'express';
import { start, stop, step, reset, status } from '../controllers/simController.js';
import { requireAuth, requireRole } from '../middleware/auth.js';

const router = Router();
router.use(requireAuth);
router.post('/start', start);
router.post('/stop', stop);
router.post('/step', step);
router.post('/reset', requireRole('agent', 'field_officer', 'ops', 'risk'), reset);
router.get('/status', status);
export default router;
