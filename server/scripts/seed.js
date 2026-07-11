import 'dotenv/config';
import bcrypt from 'bcryptjs';
import { connectDB } from '../config/db.js';
import User from '../models/User.js';
import Agent from '../models/Agent.js';
import Transaction from '../models/Transaction.js';
import Alert from '../models/Alert.js';
import { signedDelta } from '../services/signedDelta.js';
import mongoose from 'mongoose';

/*
  Synthetic data generator — ALL DATA SIMULATED (docs/data-simulation.md documents assumptions).
  Seeds: 5 staff users (one per role), 3 agent outlets, ~4h of baseline transaction
  history for AGT-001 (feeds the anomaly baseline), consistent balances
  (opening + Σ signedDelta === current, so no mismatch alert fires on clean data).
*/
const rnd = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
let seq = 0;

const PROVIDERS = ['bKash', 'Nagad', 'Rocket'];

async function seed() {
  await connectDB();
  await Promise.all([User.deleteMany({}), Agent.deleteMany({}), Transaction.deleteMany({}), Alert.deleteMany({})]);
  console.log('[seed] cleared collections');

  // ---- Staff users (console login only — never customer credentials) ----
  const hash = await bcrypt.hash('demo1234', 10);
  await User.insertMany([
    { name: 'Rahim (Agent)', email: 'agent@demo.test', passwordHash: hash, role: 'agent', area: 'Amberkhana', agentId: 'AGT-001' },
    { name: 'Karim (Field Officer)', email: 'field@demo.test', passwordHash: hash, role: 'field_officer', area: 'Amberkhana' },
    { name: 'Ops Team', email: 'ops@demo.test', passwordHash: hash, role: 'ops', providerScope: ['all'] },
    { name: 'Risk Analyst', email: 'risk@demo.test', passwordHash: hash, role: 'risk' },
    { name: 'Management', email: 'mgmt@demo.test', passwordHash: hash, role: 'management' },
  ]);
  console.log('[seed] users: agent@ / field@ / ops@ / risk@ / mgmt@ demo.test — password: demo1234');

  // ---- Agents ----
  const mkProviders = () =>
    PROVIDERS.map((p) => ({ provider: p, emoneyBalance: 0, openingBalance: rnd(40, 90) * 1000, floorThreshold: 5000 }));

  const agentsSpec = [
    { agentId: 'AGT-001', name: 'Sylhet Super Agent Point', area: 'Amberkhana', thana: 'Sylhet Sadar', district: 'Sylhet' },
    { agentId: 'AGT-002', name: 'Zindabazar Telecom', area: 'Zindabazar', thana: 'Sylhet Sadar', district: 'Sylhet' },
    { agentId: 'AGT-003', name: 'Amberkhana Store', area: 'Amberkhana', thana: 'Sylhet Sadar', district: 'Sylhet' },
  ];

  const now = new Date();
  for (const spec of agentsSpec) {
    const providers = mkProviders();
    const cashOpening = rnd(60, 120) * 1000;
    let cash = cashOpening;
    const emoney = Object.fromEntries(providers.map((p) => [p.provider, p.openingBalance]));

    // ---- 4h baseline history (only meaningful volume for AGT-001) ----
    const txns = [];
    const hours = spec.agentId === 'AGT-001' ? 4 : 1;
    for (let m = hours * 60; m > 30; m -= rnd(2, 6)) {
      const ts = new Date(now.getTime() - m * 60_000);
      const provider = pick(PROVIDERS);
      const type = pick(['cash_in', 'cash_out', 'cash_out', 'payment']); // cash_out-leaning (pre-Eid)
      const amount = rnd(5, 60) * 100;
      const t = {
        txnId: `TXN-SEED-${++seq}`, agentId: spec.agentId, provider, type, amount,
        status: Math.random() < 0.03 ? 'failed' : 'success',
        customerHash: `CUST-${rnd(1000, 9999)}`, timestamp: ts, simulated: true,
      };
      const d = signedDelta(t);
      cash += d.cash;
      emoney[provider] += d.emoney;
      t.balanceAfter = { cash, emoney: emoney[provider] };
      txns.push(t);
    }
    await Transaction.insertMany(txns);

    // Balances CONSISTENT with history: current = opening + Σ signedDelta (no false mismatch)
    for (const p of providers) p.emoneyBalance = Math.max(0, emoney[p.provider]);
    const lastFeedAt = new Map(PROVIDERS.map((p) => [p, now]));

    await Agent.create({
      ...spec,
      cashBalance: Math.max(0, cash),
      cashOpeningBalance: cashOpening,
      cashFloorThreshold: 10000,
      providers, lastFeedAt, simulated: true,
    });
    console.log(`[seed] ${spec.agentId}: cash ${Math.max(0, cash)}, ${txns.length} baseline txns`);
  }

  console.log('[seed] done. Start the server, log in, open AGT-001, press "Eid rush" (scenario A/B/C/D).');
  await mongoose.disconnect();
}

seed().catch((e) => { console.error(e); process.exit(1); });
