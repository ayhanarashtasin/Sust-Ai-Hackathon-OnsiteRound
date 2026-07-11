import { Router } from 'express';
import { start, stop, step, reset, status } from '../controllers/simController.js';
import { requireAuth, requireRole, asyncH } from '../middleware/auth.js';

/* Management is read-only: it may view sim status but not drive the simulation. */
const SIM_DRIVERS = ['agent', 'field_officer', 'ops', 'risk'];

const router = Router();
router.use(requireAuth);
router.post('/start', requireRole(...SIM_DRIVERS), asyncH(start));
router.post('/stop', requireRole(...SIM_DRIVERS), stop);
router.post('/step', requireRole(...SIM_DRIVERS), asyncH(step));
router.post('/reset', requireRole(...SIM_DRIVERS), asyncH(reset));
router.get('/status', status);
export default router;
