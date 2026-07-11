import Agent from '../models/Agent.js';
import Transaction from '../models/Transaction.js';
import Alert from '../models/Alert.js';
import { signedDelta } from './signedDelta.js';
import { forecastAgent } from './forecast.js';
import { detectAnomalies } from './anomaly.js';
import { checkStaleFeeds, checkBalanceMismatch, staleProviderSet } from './dataQuality.js';
import { generateExplanation } from './explain.js';
import { rebuildSeededState } from './demoReset.js';

/*
  Sim engine — COMPUTE-ON-WRITE (eng-review decision #2).

    every tick (2s):
      1. generate scenario txns
      2. applyTxns()  ← the SINGLE atomic balance writer (agent balances + txn docs
                        + lastFeedAt move together; mismatch alerts can only fire
                        on data we intentionally corrupt in Scenario C)
      3. recompute forecasts + anomalies + data-quality
      4. upsert alerts (dedup on agentId+subtype+provider while open)
         — NL text generated ONCE per alert creation/severity change, not per poll

  The client's 3s poll only READS. No analytics in the request path.

  Scenarios:
    A hidden provider shortage   — steady cash_in drains Nagad e-money while totals look fine
    B liquidity + unusual        — bKash repeated-amount cash-out burst from few accounts
                                   + CONTRAST: Rocket normal Eid burst (varied, many accounts) — must NOT flag
    C data inconsistency         — Rocket feed goes stale + balance nudged off-book
    D coordinated response       — Scenario B escalated volume => critical alert to walk the case lifecycle
*/

const state = { running: false, timer: null, scenario: null, agentId: null, speed: 1, tickCount: 0 };
let txnSeq = 0;
const id = (p) => `${p}-${Date.now()}-${++txnSeq}`;
const rnd = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

function makeTxn(agentId, provider, type, amount, customerHash, now) {
  return { txnId: id('TXN'), agentId, provider, type, amount, status: 'success', customerHash, timestamp: now, simulated: true };
}

/* ---------- Scenario transaction generators (per tick) ---------- */
function scenarioTxns(scenario, agentId, now, tickCount) {
  const txns = [];
  const cust = () => `CUST-${rnd(1000, 9999)}`;

  if (scenario === 'A') {
    // Nagad-heavy cash_in => Nagad e-money drains; light mixed elsewhere
    for (let i = 0; i < rnd(2, 4); i++) txns.push(makeTxn(agentId, 'Nagad', 'cash_in', rnd(3000, 8000), cust(), now));
    if (Math.random() < 0.5) txns.push(makeTxn(agentId, 'bKash', pick(['cash_in', 'cash_out']), rnd(500, 2000), cust(), now));
    if (Math.random() < 0.3) txns.push(makeTxn(agentId, 'Rocket', 'cash_out', rnd(500, 1500), cust(), now));
  }

  if (scenario === 'B' || scenario === 'D') {
    const intensity = scenario === 'D' ? 2 : 1;
    // Unusual: repeated near-identical bKash cash-outs from a tiny account set
    const suspiciousAccounts = ['CUST-0007', 'CUST-0008', 'CUST-0009'];
    for (let i = 0; i < rnd(2, 3) * intensity; i++) {
      txns.push(makeTxn(agentId, 'bKash', 'cash_out', 9800 + rnd(0, 2) * 100, pick(suspiciousAccounts), now));
    }
    // CONTRAST (must stay unflagged): Rocket normal Eid burst — varied amounts, many distinct accounts
    for (let i = 0; i < rnd(2, 3); i++) {
      txns.push(makeTxn(agentId, 'Rocket', 'cash_out', rnd(700, 6500), cust(), now));
    }
    if (Math.random() < 0.4) txns.push(makeTxn(agentId, 'Nagad', 'cash_in', rnd(1000, 3000), cust(), now));
  }

  if (scenario === 'C') {
    // Normal-ish activity; Rocket's FEED is what breaks (handled in applyTxns/corruption below)
    for (let i = 0; i < rnd(1, 3); i++) {
      txns.push(makeTxn(agentId, pick(['bKash', 'Nagad']), pick(['cash_in', 'cash_out']), rnd(800, 4000), cust(), now));
    }
    if (tickCount % 3 === 0) txns.push(makeTxn(agentId, 'Rocket', 'cash_out', rnd(800, 2000), cust(), now));
  }

  return txns;
}

/* ---------- SINGLE ATOMIC BALANCE WRITER ---------- */
export async function applyTxns(agent, txns, { staleProvider = null } = {}) {
  const now = new Date();
  for (const t of txns) {
    const d = signedDelta(t);
    agent.cashBalance = Math.max(0, agent.cashBalance + d.cash);
    const p = agent.providers.find((x) => x.provider === t.provider);
    if (p) p.emoneyBalance = Math.max(0, p.emoneyBalance + d.emoney);
    const bal = { cash: agent.cashBalance, emoney: p ? p.emoneyBalance : 0 };
    t.balanceAfter = bal;
    // Feed freshness moves WITH the balance write — except the intentionally stale provider (Scenario C)
    if (t.provider !== staleProvider) agent.lastFeedAt.set(t.provider, now);
  }
  await Transaction.insertMany(txns);
  await agent.save();
}

/* ---------- Alert upsert (dedup while open) ---------- */
const OPEN = ['new', 'acknowledged', 'in_progress', 'escalated'];
const ROUTE = { liquidity: 'field_officer', anomaly: 'ops', data_quality: 'ops' };

async function upsertAlert(agent, finding) {
  const kind = ['cash_depletion', 'emoney_depletion'].includes(finding.subtype)
    ? 'liquidity'
    : ['velocity_spike', 'repeated_amount'].includes(finding.subtype)
      ? 'anomaly'
      : 'data_quality';

  const existing = await Alert.findOne({
    agentId: agent.agentId,
    subtype: finding.subtype,
    provider: finding.provider ?? null,
    status: { $in: OPEN },
  });

  if (existing) {
    const severityChanged = existing.severity !== finding.severity;
    existing.evidence = finding.evidence;
    existing.confidence = finding.confidence;
    existing.severity = finding.severity;
    if (severityChanged) {
      // Regenerate NL text only on severity change (compute-on-write, OpenAI once — not per poll)
      const ex = await generateExplanation(finding);
      Object.assign(existing, ex);
      existing.history.push({ actorRole: 'system', action: 'severity_changed', note: `→ ${finding.severity}` });
    }
    await existing.save();
    return { alert: existing, created: false };
  }

  const ex = await generateExplanation(finding);
  const alert = new Alert({
    alertId: id('ALT'),
    agentId: agent.agentId,
    area: agent.area,
    kind,
    provider: finding.provider ?? null,
    subtype: finding.subtype,
    severity: finding.severity,
    confidence: finding.confidence,
    evidence: finding.evidence,
    possibleNormalReasons: finding.possibleNormalReasons || [],
    requiresReview: true,
    routedToRole: ROUTE[kind],
    ...ex,
    history: [{ actorRole: 'system', action: 'created', note: `routed to ${ROUTE[kind]}` }],
  });
  await alert.save();
  return { alert, created: true };
}

/* ---------- Analytics pass (compute-on-write) — also reused by validate.js ---------- */
export async function recomputeAgent(agent, now = new Date()) {
  const since = new Date(now.getTime() - 6 * 60 * 60_000); // 6h of recent txns
  const txns = await Transaction.find({ agentId: agent.agentId, timestamp: { $gte: since } }).sort({ timestamp: 1 }).lean();
  const txnsByProvider = {};
  for (const p of agent.providers) txnsByProvider[p.provider] = [];
  for (const t of txns) (txnsByProvider[t.provider] ||= []).push(t);

  const stale = staleProviderSet(agent, now);
  const findings = [];

  // Liquidity
  for (const f of forecastAgent(agent, txnsByProvider, now, stale)) {
    if (f.status === 'warning' || f.status === 'critical') {
      findings.push({
        subtype: f.resource === 'cash' ? 'cash_depletion' : 'emoney_depletion',
        provider: f.provider,
        severity: f.status,
        confidence: f.confidence,
        evidence: { ...f },
      });
    }
  }

  // Anomalies — baseline from txns older than the live window
  const baselineCutoff = new Date(now.getTime() - 60 * 60_000);
  for (const p of agent.providers) {
    const all = txnsByProvider[p.provider] || [];
    const recent = all.filter((t) => t.timestamp >= baselineCutoff);
    const baseline = all.filter((t) => t.timestamp < baselineCutoff);
    findings.push(...detectAnomalies({ provider: p.provider, recentTxns: recent, baselineTxns: baseline, now }));
  }

  // Data quality
  findings.push(...checkStaleFeeds(agent, now));
  findings.push(...checkBalanceMismatch(agent, txnsByProvider));

  const alertResults = [];
  for (const f of findings) alertResults.push(await upsertAlert(agent, f));
  return { findings, alertResults };
}

/* ---------- Tick loop ---------- */
async function tick() {
  try {
    const agent = await Agent.findOne({ agentId: state.agentId });
    if (!agent) return { error: 'Agent not found' };
    const now = new Date();
    state.tickCount++;

    const txns = scenarioTxns(state.scenario, agent.agentId, now, state.tickCount);
    const staleProvider = state.scenario === 'C' ? 'Rocket' : null;
    await applyTxns(agent, txns, { staleProvider });

    // Scenario C: once, nudge Rocket balance off-book => balance_mismatch fires on INJECTED bad data
    if (state.scenario === 'C' && state.tickCount === 5) {
      const rocket = agent.providers.find((p) => p.provider === 'Rocket');
      if (rocket) rocket.emoneyBalance += 7777;
      await agent.save();
    }

    const analysis = await recomputeAgent(agent, now);
    return { transactionCount: txns.length, ...analysis };
  } catch (err) {
    console.error('[sim] tick error:', err.message);
    return { error: err.message };
  }
}

export function startSim({ agentId, scenario = 'B', speed = 1 }) {
  stopSim();
  state.running = true;
  state.scenario = scenario;
  state.agentId = agentId;
  state.speed = speed;
  state.tickCount = 0;
  state.timer = setInterval(tick, Math.max(500, 2000 / speed));
  console.log(`[sim] started scenario ${scenario} for ${agentId} at ${speed}x`);
  return { ...state, timer: undefined };
}

export function stopSim() {
  if (state.timer) clearInterval(state.timer);
  state.timer = null;
  state.running = false;
  return { ...state, timer: undefined };
}

/*
  Manual single-step (demo walkthrough mode): runs EXACTLY ONE tick of the same
  pipeline the auto loop uses — generate → apply → recompute → upsert alerts.
  Lets a presenter narrate cause → effect per click instead of racing the 2s timer.
  Not allowed while auto mode is running (two writers would race the balances).
*/
export async function stepSim({ agentId, scenario = 'B' }) {
  if (state.running) return { error: 'Stop auto mode before stepping' };
  if (state.agentId !== agentId || state.scenario !== scenario) {
    state.tickCount = 0; // new scenario/agent: restart scenario-scripted beats (e.g. C's tick-5 corruption)
  }
  state.agentId = agentId;
  state.scenario = scenario;
  const result = await tick();
  if (result?.error) return result;
  return {
    ...simStatus(),
    transactionCount: result.transactionCount,
    findingCount: result.findings.length,
    alerts: result.alertResults.map(({ alert, created }) => ({
      alertId: alert.alertId,
      subtype: alert.subtype,
      provider: alert.provider,
      severity: alert.severity,
      evidence: alert.evidence,
      created,
    })),
  };
}

/* Restore one outlet to its seeded baseline for deterministic demo replay. */
export async function resetSimAgent(agentId) {
  stopSim();

  const agent = await Agent.findOne({ agentId });
  if (!agent) return { error: 'Agent not found' };

  const [alertsResult, transactionsResult] = await Promise.all([
    Alert.deleteMany({ agentId }),
    Transaction.deleteMany({ agentId, txnId: { $not: /^TXN-SEED-/ } }),
  ]);

  const seedTxns = await Transaction.find({ agentId, txnId: /^TXN-SEED-/ }).sort({ timestamp: 1 });
  const now = new Date();
  const baseline = rebuildSeededState(agent, seedTxns, now);

  for (let i = 0; i < seedTxns.length; i++) {
    seedTxns[i].timestamp = baseline.transactions[i].timestamp;
    seedTxns[i].balanceAfter = baseline.transactions[i].balanceAfter;
  }
  if (seedTxns.length) await Promise.all(seedTxns.map((txn) => txn.save()));

  agent.cashBalance = baseline.cashBalance;
  for (const provider of agent.providers) provider.emoneyBalance = baseline.providerBalances[provider.provider];
  agent.lastFeedAt = new Map(agent.providers.map((provider) => [provider.provider, now]));
  await agent.save();

  state.scenario = null;
  state.agentId = null;
  state.speed = 1;
  state.tickCount = 0;

  return {
    agentId,
    deletedAlerts: alertsResult.deletedCount,
    deletedTransactions: transactionsResult.deletedCount,
    baselineTransactions: seedTxns.length,
    tickCount: 0,
  };
}

export function simStatus() {
  return { running: state.running, scenario: state.scenario, agentId: state.agentId, speed: state.speed, tickCount: state.tickCount };
}
