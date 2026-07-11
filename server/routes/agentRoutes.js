import { Router } from 'express';
import { listAgents, getAgent, getTransactions, getForecast } from '../controllers/agentController.js';
import { requireAuth } from '../middleware/auth.js';

const router = Router();
router.use(requireAuth);
router.get('/', listAgents);
router.get('/:id', getAgent);
router.get('/:id/transactions', getTransactions);
router.get('/:id/forecast', getForecast);
export default router;
