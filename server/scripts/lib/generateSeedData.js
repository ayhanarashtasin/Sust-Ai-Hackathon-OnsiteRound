import { signedDelta } from '../../services/signedDelta.js';

/*
  Pure synthetic-data generator — shared by `npm run seed` (writes MongoDB) and
  `npm run sample-data` (writes the portable dataset committed in data/sample/).
  One code path guarantees the committed sample matches what judges see live.

  DETERMINISTIC: mulberry32 PRNG; same seed => identical outlets, history, balances.
  ALL DATA SIMULATED — synthetic identifiers only, no real customers or balances.
*/
export function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const PROVIDERS = ['bKash', 'Nagad', 'Rocket'];

export const USERS_SPEC = [
  { name: 'Rahim (Agent)', email: 'agent@demo.test', role: 'agent', area: 'Amberkhana', agentId: 'AGT-001' },
  { name: 'Karim (Field Officer)', email: 'field@demo.test', role: 'field_officer', area: 'Amberkhana' },
  { name: 'Ops Team', email: 'ops@demo.test', role: 'ops', providerScope: ['all'] },
  { name: 'Risk Analyst', email: 'risk@demo.test', role: 'risk' },
  { name: 'Management', email: 'mgmt@demo.test', role: 'management' },
];

export const AGENTS_SPEC = [
  { agentId: 'AGT-001', name: 'Sylhet Super Agent Point', area: 'Amberkhana', thana: 'Sylhet Sadar', district: 'Sylhet' },
  { agentId: 'AGT-002', name: 'Zindabazar Telecom', area: 'Zindabazar', thana: 'Sylhet Sadar', district: 'Sylhet' },
  { agentId: 'AGT-003', name: 'Amberkhana Store', area: 'Amberkhana', thana: 'Sylhet Sadar', district: 'Sylhet' },
];

/*
  Generates the full synthetic ecosystem: 3 outlets, provider balances, and
  ~4h of baseline history for AGT-001 (the anomaly detector's baseline).
  Balances are CONSISTENT with history (opening + Σ signedDelta === current),
  and a txn the outlet could not cover is recorded as failed (insufficient_funds)
  — running balances never go negative, so no false mismatch alert on clean data.
*/
export function generateSeedData({ seed = 20260711, now = new Date() } = {}) {
  const random = mulberry32(seed);
  const rnd = (min, max) => Math.floor(random() * (max - min + 1)) + min;
  const pick = (arr) => arr[Math.floor(random() * arr.length)];
  let seq = 0;

  const agents = [];
  const transactions = [];

  for (const spec of AGENTS_SPEC) {
    const providers = PROVIDERS.map((p) => ({
      provider: p, emoneyBalance: 0, openingBalance: rnd(40, 90) * 1000, floorThreshold: 5000,
    }));
    const cashOpening = rnd(60, 120) * 1000;
    let cash = cashOpening;
    const emoney = Object.fromEntries(providers.map((p) => [p.provider, p.openingBalance]));

    const hours = spec.agentId === 'AGT-001' ? 4 : 1;
    for (let m = hours * 60; m > 30; m -= rnd(2, 6)) {
      const ts = new Date(now.getTime() - m * 60_000);
      const provider = pick(PROVIDERS);
      const type = pick(['cash_in', 'cash_out', 'cash_out', 'payment']); // cash_out-leaning (pre-Eid)
      const amount = rnd(5, 60) * 100;
      const t = {
        txnId: `TXN-SEED-${++seq}`, agentId: spec.agentId, provider, type, amount,
        status: random() < 0.03 ? 'failed' : 'success', failureReason: null,
        customerHash: `CUST-${rnd(1000, 9999)}`, timestamp: ts, simulated: true,
      };
      const d = signedDelta(t);
      if (cash + d.cash < 0 || emoney[provider] + d.emoney < 0) {
        t.status = 'failed';
        t.failureReason = 'insufficient_funds';
      } else {
        cash += d.cash;
        emoney[provider] += d.emoney;
      }
      t.balanceAfter = { cash, emoney: emoney[provider] };
      transactions.push(t);
    }

    for (const p of providers) p.emoneyBalance = emoney[p.provider];
    agents.push({
      ...spec,
      cashBalance: cash,
      cashOpeningBalance: cashOpening,
      cashFloorThreshold: 10000,
      providers,
      lastFeedAt: Object.fromEntries(PROVIDERS.map((p) => [p, now])),
      simulated: true,
    });
  }

  return { seed, users: USERS_SPEC.map((u) => ({ ...u, simulated: true })), agents, transactions };
}
