import 'dotenv/config';
import { appendFile, mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { buildFeatureSnapshot, FEATURE_COLUMNS } from '../services/ml/featurePipeline.js';

/*
  ML dataset generator — realistic, NOT trivially separable.

  Why this shape (vs. a naive scenario->label map):
    - Liquidity labels come from the REALIZED stochastic future (did the balance actually
      cross critical in the next 60 min), so they are uncertain given the current features.
    - Anomalies use DIVERSE signatures (structuring / velocity / concentration / off-hours)
      with VARIED parameters, and they overlap with legitimate Eid/salary surges — so no single
      feature is an oracle; the model must learn combinations.
    - Label noise simulates human-review disagreement; data-quality noise (stale/missing feeds,
      reconciliation gaps) is injected independently of the labels.
    - A few "holdout" agents come online only in the test period => genuine unseen-agent eval.
  Everything is deterministic given the seed. Features are produced by the SAME
  buildFeatureSnapshot the runtime uses, so there is no train/serve feature drift.
*/

const PROVIDERS = ['bKash', 'Nagad', 'Rocket'];
const SEED = Number(process.env.ML_SEED || process.env.SEED || 20260711);
const DAYS = Number(process.env.ML_DATASET_DAYS || 30);
const AGENT_COUNT = Number(process.env.ML_DATASET_AGENTS || 26);
const HOLDOUT = Number(process.env.ML_DATASET_HOLDOUT || 4); // "new" agents seen only in the test period
const SLOT_MINUTES = Number(process.env.ML_SLOT_MINUTES || 15);
const LOOKBACK_MIN = Number(process.env.ML_LOOKBACK_DAYS || 3) * 24 * 60;
// Asymmetric review error: some true events are missed (FN), very few clean rows are
// over-flagged (FP). Symmetric noise at a ~5% base rate would make ~40% of positives pure
// noise; the hard part of the task should come from feature overlap, not label corruption.
const NOISE_FN = Number(process.env.ML_NOISE_FN || 0.05); // true positive recorded as negative
const NOISE_FP = Number(process.env.ML_NOISE_FP || 0.005); // true negative recorded as positive
const applyNoise = (label) => (label === 1 ? (chance(NOISE_FN) ? 0 : 1) : (chance(NOISE_FP) ? 1 : 0));
const OUT = resolve(process.cwd(), process.env.ML_DATASET_DIR || '../data/ml');
const START = new Date('2026-01-01T00:00:00.000Z');
const SLOTS_PER_DAY = (24 * 60) / SLOT_MINUTES;
const TOTAL_SLOTS = DAYS * SLOTS_PER_DAY;
const VAL_START = Math.floor(TOTAL_SLOTS * 0.6);
const TEST_START = Math.floor(TOTAL_SLOTS * 0.8);
const HORIZON_MS = 60 * 60_000;
const DAY_MS = 24 * 60 * 60_000;

function mulberry32(seed) {
  let value = seed >>> 0;
  return () => {
    value += 0x6d2b79f5;
    let t = value;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const random = mulberry32(SEED);
const rand = (min, max) => min + random() * (max - min);
const randInt = (min, max) => Math.floor(random() * (max - min + 1)) + min;
const chance = (probability) => random() < probability;
const pick = (items) => items[Math.floor(random() * items.length)];

// Standard normal via Box-Muller, with a cached spare — deterministic given the seed.
let gaussSpare = null;
function gauss(mean = 0, sd = 1) {
  if (gaussSpare !== null) {
    const value = gaussSpare;
    gaussSpare = null;
    return mean + sd * value;
  }
  const u = Math.max(1e-9, random());
  const v = random();
  const radius = Math.sqrt(-2 * Math.log(u));
  gaussSpare = radius * Math.sin(2 * Math.PI * v);
  return mean + sd * radius * Math.cos(2 * Math.PI * v);
}
const lognormalAmount = (mu, sigma) => Math.max(50, Math.round(Math.exp(gauss(mu, sigma)) / 50) * 50);

// Two demand humps (mid-day + evening), quiet overnight.
function diurnal(hour) {
  return 0.15 + 0.6 * Math.exp(-((hour - 12) ** 2) / 18) + 0.5 * Math.exp(-((hour - 19) ** 2) / 6);
}

function eventContext(at) {
  const date = new Date(at);
  const day = date.getUTCDate();
  const dayOfWeek = date.getUTCDay();
  const hour = date.getUTCHours();
  const eid = at >= new Date('2026-01-19T00:00:00.000Z') && at < new Date('2026-01-23T00:00:00.000Z');
  const salaryDay = day === 25 || day === 26 || day === 1;
  const localEvent = dayOfWeek === 4 && hour >= 16 && hour <= 20;
  const busyHour = hour >= 16 && hour <= 21;
  const flag = eid ? 'eid' : salaryDay ? 'salary_day' : localEvent ? 'local_event' : 'none';
  return { eid, salaryDay, localEvent, busyHour, flag };
}

let txnSeq = 0;
function makeTxn(agent, provider, type, amount, timestamp, customerHash, eventFlag) {
  return {
    txnId: `ML-TXN-${++txnSeq}`, agentId: agent.agentId, provider, type, amount,
    status: 'success', failureReason: null, customerHash, timestamp,
    dataReceivedAt: timestamp, area: agent.area, eventFlag, simulated: true,
    balanceAfter: { cash: 0, emoney: 0 },
  };
}

function settle(agent, txn) {
  const provider = agent.providers.find((item) => item.provider === txn.provider);
  if (txn.type === 'cash_out') {
    if (agent.cashCurrent < txn.amount) { txn.status = 'failed'; txn.failureReason = 'insufficient_funds'; }
    else { agent.cashCurrent -= txn.amount; provider.emoney += txn.amount; }
  } else { // cash_in
    if (provider.emoney < txn.amount) { txn.status = 'failed'; txn.failureReason = 'insufficient_funds'; }
    else { agent.cashCurrent += txn.amount; provider.emoney -= txn.amount; }
  }
  txn.balanceAfter = { cash: agent.cashCurrent, emoney: provider.emoney };
}

function makeAgent(index) {
  const holdout = index >= AGENT_COUNT - HOLDOUT;
  const thin = random() < 0.35; // thin-float agents are shortage-prone
  const cashOpen = thin ? randInt(26_000, 46_000) : randInt(90_000, 150_000);
  return {
    agentId: `ML-AGT-${String(index + 1).padStart(3, '0')}`,
    area: `Synthetic Area ${(index % 5) + 1}`,
    index, holdout, thin,
    baseRate: rand(2.5, 5.5),
    anomalyProneness: rand(0.5, 2.0),
    cashCurrent: cashOpen, cashOpening: cashOpen, cashFloor: 12_000, cashCritical: 6_000,
    providers: PROVIDERS.map((provider) => {
      const opening = thin ? randInt(12_000, 22_000) : randInt(50_000, 100_000);
      return {
        provider, emoney: opening, opening, floor: 5_000, critical: 2_500,
        bias: provider === 'bKash' ? 1.12 : provider === 'Nagad' ? 0.98 : 0.9,
      };
    }),
    feedAt: new Map(PROVIDERS.map((provider) => [provider, START])),
  };
}

// Diverse anomaly signatures — varied parameters, overlapping with legit behaviour.
function injectAnomaly(agent, providerObj, asOf, hour, ctx, txns) {
  const provider = providerObj.provider;
  const types = ['structuring', 'velocity', 'concentration'];
  if (hour < 6 || hour > 22) types.push('offhours_high');
  const type = pick(types);
  const push = (t) => { settle(agent, t); txns.push(t); };
  if (type === 'structuring') {
    const base = randInt(3_000, 9_500); // NOT a fixed giveaway value
    for (let i = 0, n = randInt(5, 9); i < n; i++) {
      push(makeTxn(agent, provider, 'cash_out', base + randInt(-1, 1) * 100, asOf, `SYN-A${randInt(1, 2)}`, ctx.flag));
    }
  } else if (type === 'velocity') {
    for (let i = 0, n = randInt(10, 18); i < n; i++) {
      push(makeTxn(agent, provider, random() < 0.5 ? 'cash_out' : 'cash_in', randInt(3, 15) * 100, asOf, `SYN-A${randInt(1, 3)}`, ctx.flag));
    }
  } else if (type === 'concentration') {
    const customer = 'SYN-A1';
    for (let i = 0, n = randInt(6, 10); i < n; i++) {
      push(makeTxn(agent, provider, 'cash_out', lognormalAmount(Math.log(2_500), 0.6), asOf, customer, ctx.flag));
    }
  } else {
    for (let i = 0, n = randInt(1, 3); i < n; i++) {
      push(makeTxn(agent, provider, 'cash_out', randInt(15_000, 40_000), asOf, `SYN-A${randInt(1, 2)}`, ctx.flag));
    }
  }
  return type;
}

// Between-slot rebalancing: agents restock the cash drawer from the bank and top up
// e-money float. This is NOT a customer transaction, so it moves the balance without
// touching flow features — and it makes a shortage a TRANSIENT, rarer event instead of a
// permanent absorbing state (which is what inflated the positive rate to ~50%).
function replenish(agent) {
  if (agent.cashCurrent < agent.cashFloor * 1.4 && chance(0.6)) {
    agent.cashCurrent = Math.round(agent.cashOpening * rand(0.75, 1.0));
  }
  for (const providerObj of agent.providers) {
    if (providerObj.emoney < providerObj.floor * 1.4 && chance(0.6)) {
      providerObj.emoney = Math.round(providerObj.opening * rand(0.75, 1.0));
    }
  }
}

function generateSlot(agent, asOf) {
  replenish(agent);
  const ctx = eventContext(asOf);
  const hour = asOf.getUTCHours();
  const txns = [];
  const anomaly = { bKash: false, Nagad: false, Rocket: false };
  const mismatch = { bKash: 0, Nagad: 0, Rocket: 0 };
  const demand = agent.baseRate * diurnal(hour)
    * (ctx.eid ? 2.0 : 1) * (ctx.salaryDay ? 1.4 : 1) * (ctx.localEvent ? 1.3 : 1) * (ctx.busyHour ? 1.4 : 1);
  for (const providerObj of agent.providers) {
    const provider = providerObj.provider;
    const count = Math.max(0, Math.round(gauss(demand * providerObj.bias, Math.sqrt(Math.max(0.5, demand)))));
    for (let i = 0; i < count; i++) {
      const type = random() < 0.5 ? 'cash_out' : 'cash_in';
      const amount = lognormalAmount(Math.log(ctx.eid ? 2_600 : 1_500), 0.7);
      const txn = makeTxn(agent, provider, type, amount, asOf, `SYN-${randInt(1, 400)}`, ctx.flag);
      settle(agent, txn);
      txns.push(txn);
    }
    if (chance(0.012 * agent.anomalyProneness)) {
      injectAnomaly(agent, providerObj, asOf, hour, ctx, txns);
      anomaly[provider] = true;
    }
    // Data-quality noise — independent of the labels, so it cannot be an oracle.
    if (chance(0.03)) agent.feedAt.set(provider, new Date(asOf.getTime() - randInt(12, 40) * 60_000)); // stale
    else if (chance(0.01)) agent.feedAt.delete(provider); // missing feed this slot
    else agent.feedAt.set(provider, asOf);
    if (chance(0.02)) mismatch[provider] = randInt(2_000, 9_000); // reconciliation gap
  }
  return { ctx, txns, anomaly, mismatch };
}

function csv(value) {
  const text = String(value ?? '');
  return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

async function main() {
  await mkdir(OUT, { recursive: true });
  const featurePath = resolve(OUT, 'features.csv');
  const liquidityPath = resolve(OUT, 'liquidity_labels.csv');
  const anomalyPath = resolve(OUT, 'anomaly_labels.csv');
  const featureColumns = ['record_id', 'timestamp', 'split', ...FEATURE_COLUMNS];
  await writeFile(featurePath, featureColumns.join(',') + '\n', 'utf8');
  await writeFile(liquidityPath, 'record_id,label\n', 'utf8');
  await writeFile(anomalyPath, 'record_id,label\n', 'utf8');

  const stats = {
    train: { n: 0, liq: 0, ano: 0 },
    validation: { n: 0, liq: 0, ano: 0 },
    test: { n: 0, liq: 0, ano: 0 },
  };
  let totalRows = 0;

  for (let agentIndex = 0; agentIndex < AGENT_COUNT; agentIndex++) {
    const agent = makeAgent(agentIndex);
    const history = [];
    const states = new Array(TOTAL_SLOTS).fill(null);

    // Pass 1 — forward-simulate the whole period, recording per-slot state.
    for (let slot = 0; slot < TOTAL_SLOTS; slot++) {
      const asOf = new Date(START.getTime() + slot * SLOT_MINUTES * 60_000);
      if (agent.holdout && slot < TEST_START) continue; // unseen agent: inactive until test period
      const { ctx, txns, anomaly, mismatch } = generateSlot(agent, asOf);
      history.push(...txns);
      states[slot] = {
        asOf, ctx, anomaly, mismatch,
        cash: agent.cashCurrent,
        emoney: Object.fromEntries(agent.providers.map((p) => [p.provider, p.emoney])),
        feedAt: new Map(PROVIDERS.map((p) => [p, agent.feedAt.get(p) ?? null])),
      };
    }

    // Pass 2 — features (as-of asOf) + labels (realized future), streamed to disk per agent.
    const featureLines = [];
    const liquidityLines = [];
    const anomalyLines = [];
    const shortTimes = { bKash: [], Nagad: [], Rocket: [] };
    let lo = 0;
    let hi = 0;
    for (let slot = 0; slot < TOTAL_SLOTS; slot++) {
      const state = states[slot];
      if (!state) continue;
      const asOf = state.asOf;
      const asOfMs = asOf.getTime();
      while (lo < history.length && history[lo].timestamp.getTime() < asOfMs - LOOKBACK_MIN * 60_000) lo++;
      while (hi < history.length && history[hi].timestamp.getTime() <= asOfMs) hi++;
      const windowTxns = history.slice(lo, hi); // (asOf - lookback, asOf]
      let futureEnd = hi;
      while (futureEnd < history.length && history[futureEnd].timestamp.getTime() <= asOfMs + HORIZON_MS) futureEnd++;
      const future = history.slice(hi, futureEnd); // (asOf, asOf + 60min]

      const agentView = {
        agentId: agent.agentId, area: agent.area,
        cashBalance: state.cash, cashOpeningBalance: agent.cashOpening,
        cashFloorThreshold: agent.cashFloor, cashCriticalThreshold: agent.cashCritical,
        providers: agent.providers.map((p) => ({
          provider: p.provider, emoneyBalance: state.emoney[p.provider],
          openingBalance: p.opening, floorThreshold: p.floor, criticalThreshold: p.critical,
        })),
        lastFeedAt: state.feedAt,
      };
      const split = agent.holdout ? 'test' : slot < VAL_START ? 'train' : slot < TEST_START ? 'validation' : 'test';
      const cashShort = future.some((t) => t.status === 'success' && t.balanceAfter.cash <= agent.cashCritical);

      for (const providerObj of agent.providers) {
        const provider = providerObj.provider;
        shortTimes[provider] = shortTimes[provider].filter((t) => t >= asOfMs - DAY_MS);
        const previousShortageCount = shortTimes[provider].length;
        const snapshot = buildFeatureSnapshot({
          agent: agentView, provider, transactions: windowTxns, asOf,
          context: { salaryDay: state.ctx.salaryDay, eid: state.ctx.eid, localEvent: state.ctx.localEvent, previousShortageCount },
          dataQuality: { balanceMismatchAmount: state.mismatch[provider], cashBalanceMismatchAmount: 0 },
        });

        const providerShort = future.some((t) => t.status === 'success' && t.provider === provider && t.balanceAfter.emoney <= providerObj.critical);
        const shortageRealized = cashShort || providerShort;
        if (shortageRealized) shortTimes[provider].push(asOfMs);
        const liq = applyNoise(shortageRealized ? 1 : 0);
        const ano = applyNoise(state.anomaly[provider] ? 1 : 0);

        const recordId = `ML-${agent.agentId}-S${slot}-${provider}`;
        featureLines.push(featureColumns.map((column) => {
          if (column === 'record_id') return recordId;
          if (column === 'timestamp') return asOf.toISOString();
          if (column === 'split') return split;
          return csv(snapshot.values[column]);
        }).join(','));
        liquidityLines.push(`${recordId},${liq}`);
        anomalyLines.push(`${recordId},${ano}`);
        stats[split].n++; stats[split].liq += liq; stats[split].ano += ano;
        totalRows++;
      }
    }
    await appendFile(featurePath, featureLines.join('\n') + '\n', 'utf8');
    await appendFile(liquidityPath, liquidityLines.join('\n') + '\n', 'utf8');
    await appendFile(anomalyPath, anomalyLines.join('\n') + '\n', 'utf8');
  }

  await writeFile(resolve(OUT, 'manifest.json'), JSON.stringify({
    generatedAt: new Date().toISOString(), seed: SEED,
    agentCount: AGENT_COUNT, holdoutAgents: HOLDOUT, days: DAYS,
    slotMinutes: SLOT_MINUTES, lookbackDays: LOOKBACK_MIN / (24 * 60),
    rows: totalRows, featureSchemaVersion: '1.0.0', transactions: txnSeq,
    reviewErrorRates: { missed: NOISE_FN, overFlagged: NOISE_FP },
    labels: {
      liquidity: 'shared cash or provider e-money reaches its critical threshold within the next 60 minutes (from realized stochastic demand)',
      anomaly: 'unusual activity requiring human review (structuring / velocity / concentration / off-hours high value)',
    },
    splits: stats,
    positiveRate: {
      liquidity: Number(((stats.train.liq + stats.validation.liq + stats.test.liq) / totalRows).toFixed(4)),
      anomaly: Number(((stats.train.ano + stats.validation.ano + stats.test.ano) / totalRows).toFixed(4)),
    },
    design: [
      'Liquidity labels are the realized future, not a scenario flag => uncertain given current features.',
      'Anomalies use diverse, varied signatures that overlap with legitimate Eid/salary surges.',
      'Label noise simulates human-review disagreement; data-quality noise is label-independent.',
      'Holdout agents appear only in the test period for genuine unseen-agent evaluation.',
    ],
    limitations: ['Synthetic data only', 'Scenario identity is excluded from model features', 'No real customer identities or provider accounts'],
  }, null, 2) + '\n', 'utf8');

  console.log(JSON.stringify({ out: OUT, rows: totalRows, transactions: txnSeq, seed: SEED, splits: stats, positiveRate: {
    liquidity: (stats.train.liq + stats.validation.liq + stats.test.liq) / totalRows,
    anomaly: (stats.train.ano + stats.validation.ano + stats.test.ano) / totalRows,
  } }, null, 2));
}

main().catch((error) => {
  console.error('[ml-dataset]', error.stack || error.message);
  process.exit(1);
});
