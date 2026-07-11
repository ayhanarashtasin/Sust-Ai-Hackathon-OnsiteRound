import { Router } from 'express';
import { listAgents, getAgent, getTransactions, getForecast, getManagementOverview } from '../controllers/agentController.js';
import { getAnomalies, getDecisionSupport } from '../controllers/decisionController.js';
import { requireAuth, requireRole, asyncH } from '../middleware/auth.js';

const router = Router();
router.use(requireAuth);
router.get('/management-overview', requireRole('management'), asyncH(getManagementOverview));
router.get('/', requireRole('agent', 'field_officer', 'ops'), asyncH(listAgents));
router.get('/:id', requireRole('agent', 'field_officer', 'ops'), asyncH(getAgent));
router.get('/:id/transactions', requireRole('agent', 'field_officer', 'ops'), asyncH(getTransactions));
router.get('/:id/forecast', requireRole('agent', 'field_officer', 'ops'), asyncH(getForecast));
router.get('/:id/decision-support', requireRole('agent', 'field_officer', 'ops'), asyncH(getDecisionSupport));
router.get('/:id/anomalies', requireRole('agent', 'field_officer', 'ops'), asyncH(getAnomalies));
export default router;
