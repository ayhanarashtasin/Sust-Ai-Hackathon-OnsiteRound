import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import mongoose from 'mongoose';
import { connectDB } from './config/db.js';
import { jwtSecret } from './middleware/auth.js';
import authRoutes from './routes/authRoutes.js';
import agentRoutes from './routes/agentRoutes.js';
import alertRoutes from './routes/alertRoutes.js';
import simRoutes from './routes/simRoutes.js';
import modelRoutes from './routes/modelRoutes.js';

/*
  MVC layout:
    models/       Mongoose schemas (data)
    controllers/  thin request handlers
    services/     analytics engines + sim (business logic)
    routes/       wiring only
    views         = React client (separate app, /client)
*/
jwtSecret(); // fail fast at boot if JWT_SECRET is missing — never run on a known secret

const app = express();

// CORS: dev client origins only (the Vite proxy makes most requests same-origin anyway).
const ORIGINS = (process.env.CLIENT_ORIGIN || 'http://localhost:5173,http://127.0.0.1:5173').split(',');
app.use(cors({ origin: ORIGINS }));
app.use(express.json({ limit: '100kb' }));

// Structured request log with a per-request id — observability for the demo
// (who asked what, how long it took, what came back).
let reqSeq = 0;
app.use((req, res, next) => {
  req.id = `req-${Date.now()}-${++reqSeq}`;
  const t0 = process.hrtime.bigint();
  res.on('finish', () => {
    const ms = Number(process.hrtime.bigint() - t0) / 1e6;
    // console.log(JSON.stringify({ id: req.id, method: req.method, path: req.path, status: res.statusCode, ms: Math.round(ms * 10) / 10 }));
  });
  next();
});

// Health reflects reality: report and 503 when MongoDB is down instead of a hollow ok:true.
app.get('/api/health', (_req, res) => {
  const dbUp = mongoose.connection.readyState === 1;
  res.status(dbUp ? 200 : 503).json({ ok: dbUp, db: dbUp ? 'connected' : 'disconnected', simulated: true });
});
app.use('/api/auth', authRoutes);
app.use('/api/agents', agentRoutes);
app.use('/api/alerts', alertRoutes);
app.use('/api/sim', simRoutes);
app.use('/api/models', modelRoutes);

// Central error handler — log details server-side (with the request id), return
// a generic message: internal exception text never reaches clients.
app.use((err, req, res, _next) => {
  console.error('[error]', req.id, err.stack || err.message);
  res.status(500).json({ error: 'Internal error', requestId: req.id });
});

const PORT = process.env.PORT || 5000;
connectDB()
  .then(() => {
    const server = app.listen(PORT, () => console.log(`[server] listening on :${PORT} — SIMULATED DATA ONLY`));
    // Graceful shutdown: stop accepting connections, then close the DB.
    const shutdown = (signal) => {
      console.log(`[server] ${signal} — shutting down`);
      server.close(() => mongoose.disconnect().then(() => process.exit(0)));
      setTimeout(() => process.exit(1), 5000).unref(); // hard exit if close hangs
    };
    process.on('SIGINT', () => shutdown('SIGINT'));
    process.on('SIGTERM', () => shutdown('SIGTERM'));
  })
  .catch((err) => {
    console.error('[server] Mongo connection failed:', err.message);
    console.error('  → Set MONGO_URI in server/.env (local mongod or Atlas). See .env.example');
    process.exit(1);
  });
