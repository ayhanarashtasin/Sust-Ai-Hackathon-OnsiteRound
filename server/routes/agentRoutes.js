import { Router } from 'express';
import { listAgents, getAgent, getTransactions, getForecast } from '../controllers/agentController.js';
import { getAnomalies, getDecisionSupport } from '../controllers/decisionController.js';
import { requireAuth, asyncH } from '../middleware/auth.js';

const router = Router();
router.use(requireAuth);
router.get('/', asyncH(listAgents));
router.get('/:id', asyncH(getAgent));
router.get('/:id/transactions', asyncH(getTransactions));
router.get('/:id/forecast', asyncH(getForecast));
router.get('/:id/decision-support', asyncH(getDecisionSupport));
router.get('/:id/anomalies', asyncH(getAnomalies));
export default router;
