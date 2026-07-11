import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { connectDB } from './config/db.js';
import authRoutes from './routes/authRoutes.js';
import agentRoutes from './routes/agentRoutes.js';
import alertRoutes from './routes/alertRoutes.js';
import simRoutes from './routes/simRoutes.js';

/*
  MVC layout:
    models/       Mongoose schemas (data)
    controllers/  thin request handlers
    services/     analytics engines + sim (business logic)
    routes/       wiring only
    views         = React client (separate app, /client)
*/
const app = express();
app.use(cors());
app.use(express.json());

app.get('/api/health', (_req, res) => res.json({ ok: true, simulated: true }));
app.use('/api/auth', authRoutes);
app.use('/api/agents', agentRoutes);
app.use('/api/alerts', alertRoutes);
app.use('/api/sim', simRoutes);

// Central error handler — bad data must never silently produce confident output
app.use((err, _req, res, _next) => {
  console.error('[error]', err.message);
  res.status(500).json({ error: 'Internal error', detail: err.message });
});

const PORT = process.env.PORT || 5000;
connectDB()
  .then(() => app.listen(PORT, () => console.log(`[server] listening on :${PORT} — SIMULATED DATA ONLY`)))
  .catch((err) => {
    console.error('[server] Mongo connection failed:', err.message);
    console.error('  → Set MONGO_URI in server/.env (local mongod or Atlas). See .env.example');
    process.exit(1);
  });
