import { Router } from 'express';
import { requireAuth, asyncH } from '../middleware/auth.js';
import { getModelMetrics, getModelStatus } from '../controllers/modelController.js';

const router = Router();
router.use(requireAuth);
router.get('/status', asyncH(getModelStatus));
router.get('/metrics', asyncH(getModelMetrics));

export default router;
