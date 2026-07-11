import { Router } from 'express';
import { listAgents, getAgent, getTransactions, getForecast } from '../controllers/agentController.js';
import { requireAuth, asyncH } from '../middleware/auth.js';

const router = Router();
router.use(requireAuth);
router.get('/', asyncH(listAgents));
router.get('/:id', asyncH(getAgent));
router.get('/:id/transactions', asyncH(getTransactions));
router.get('/:id/forecast', asyncH(getForecast));
export default router;
