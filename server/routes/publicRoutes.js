import { Router } from 'express';
import { getServiceStatus } from '../controllers/publicController.js';

const router = Router();

router.get('/service-status', getServiceStatus);

export default router;
