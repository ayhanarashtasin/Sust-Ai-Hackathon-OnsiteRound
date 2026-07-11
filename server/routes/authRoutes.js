import { Router } from 'express';
import { login, me } from '../controllers/authController.js';
import { requireAuth, asyncH } from '../middleware/auth.js';

const router = Router();
router.post('/login', asyncH(login));
router.get('/me', requireAuth, me);
export default router;
