import 'dotenv/config';
import bcrypt from 'bcryptjs';
import { connectDB } from '../config/db.js';
import User from '../models/User.js';
import Agent from '../models/Agent.js';
import Transaction from '../models/Transaction.js';
import Alert from '../models/Alert.js';
import Prediction from '../models/Prediction.js';
import mongoose from 'mongoose';
import { generateSeedData } from './lib/generateSeedData.js';

/*
  Database seeder — thin wrapper over the shared PURE generator
  (scripts/lib/generateSeedData.js), which is also what produces the committed
  portable dataset in data/sample/. ALL DATA SIMULATED.

  DETERMINISTIC: SEED env var (default 20260711) — every run reproduces the
  same outlets, history, and balances. docs/data-simulation.md documents assumptions.
*/
const SEED = Number(process.env.SEED || 20260711);

async function seed() {
  await connectDB();
  await Promise.all([User.deleteMany({}), Agent.deleteMany({}), Transaction.deleteMany({}), Alert.deleteMany({}), Prediction.deleteMany({})]);
  console.log(`[seed] cleared collections (PRNG seed: ${SEED})`);

  const data = generateSeedData({ seed: SEED });

  // ---- Staff users (console login only — never customer credentials) ----
  const hash = await bcrypt.hash('demo1234', 10);
  await User.insertMany(data.users.map((u) => ({ ...u, passwordHash: hash })));
  console.log('[seed] users: agent@ / field@ / ops@ / risk@ / mgmt@ demo.test — password: demo1234');

  await Transaction.insertMany(data.transactions);
  for (const a of data.agents) {
    await Agent.create({ ...a, lastFeedAt: new Map(Object.entries(a.lastFeedAt)) });
    console.log(`[seed] ${a.agentId}: cash ${a.cashBalance}, ${data.transactions.filter((t) => t.agentId === a.agentId).length} baseline txns`);
  }

  console.log('[seed] done. Start the server, log in, open AGT-001, press "Eid rush" (scenario A/B/C/D).');
  await mongoose.disconnect();
}

seed().catch((e) => { console.error(e); process.exit(1); });
