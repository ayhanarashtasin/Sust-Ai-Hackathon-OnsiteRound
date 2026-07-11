import Agent from '../models/Agent.js';
import Transaction from '../models/Transaction.js';
import Alert from '../models/Alert.js';
import { signedDelta } from './signedDelta.js';
import { forecastAgent } from './forecast.js';
import { detectAnomalies } from './anomaly.js';
import { providerDataIssues, STALE_MIN } from './dataQuality.js';
import { generateExplanation } from './explain.js';
import { rebuildSeededState } from './demoReset.js';
import { evaluateDecisionSupport } from './ml/decisionSupport.js';

/*
  Sim engine — COMPUTE-ON-WRITE (eng-review decision #2).

    every tick (2s):
      1. generate scenario txns
      2. applyTxns()  ← the single balance-writer CODE PATH. Balances live in one
                        agent document (that save is atomic); the txn insert is a
                        SEPARATE write — not a multi-document transaction. If a
                        crash lands between the two, the discrepancy surfaces as
                        a balance_mismatch data-quality alert instead of silent
                        corruption (fail-loud, documented in docs/architecture.md).
      3. recompute forecasts + anomalies + data-quality
      4. upsert alerts (dedup on agentId+subtype+provider while open)
         — NL text generated ONCE per alert creation/severity change, not per poll

  The client's 3s poll only READS. No alert writes or NL generation in the request path.

  Scenarios:
    A hidden provider shortage   — steady cash_in drains Nagad e-money while totals look fine
    B liquidity + unusual        — bKash repeated-amount cash-out burst from few accounts
                                   + CONTRAST: Rocket diverse Eid burst (varied, many accounts)
                                   → classified demand_surge (info), never a review flag
    C data inconsistency         — Rocket feed goes stale (backdated on first tick so the
                                   demo shows it in seconds) + balance nudged off-book
    D coordinated response       — Scenario B escalated volume => critical alert to walk the case lifecycle
*/

const state = { running: false, ticking: false, timer: null, scenario: null, agentId: null, speed: 1, tickCount: 0 };
let txnSeq = 0;
const id = (p) => `${p}-${Date.now()}-${++txnSeq}`;
const rnd = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

function makeTxn(agentId, provider, type, amount, customerHash, now) {
  return { txnId: id('TXN'), agentId, provider, type, amount, status: 'success', customerHash, timestamp: now, simulated: true };
}

/* ---------- Scenario transaction generators (per tick) ---------- */
export function scenarioTxns(scenario, agentId, now, tickCount) {
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
    // CONTRAST: Rocket diverse Eid burst — varied amounts, many distinct accounts.
    // The velocity detector classifies this demand_surge (info), NOT a review flag.
    for (let i = 0; i < rnd(2, 3); i++) {
      txns.push(makeTxn(agentId, 'Rocket', 'cash_out', rnd(700, 6500), cust(), now));
    }
    if (Math.random() < 0.4) txns.push(makeTxn(agentId, 'Nagad', 'cash_in', rnd(1000, 3000), cust(), now));
  }

  if (scenario === 'C') {
    // Normal-ish activity; Rocket's FEED is what breaks (backdated at tick 1, corrupted at tick 5)
    for (let i = 0; i < rnd(1, 3); i++) {
      txns.push(makeTxn(agentId, pick(['bKash', 'Nagad']), pick(['cash_in', 'cash_out']), rnd(800, 4000), cust(), now));
    }
    if (tickCount % 3 === 0) txns.push(makeTxn(agentId, 'Rocket', 'cash_out', rnd(800, 2000), cust(), now));
  }

  return txns;
}

/* ---------- Balance application (pure core — unit-testable without a DB) ----------
   A transaction the agent cannot cover FAILS (insufficient_funds) and moves nothing —
   exactly what happens at a real outlet when the drawer or float runs dry. Never clamp:
   clamping fabricates value on one side and breaks opening+Σdeltas reconciliation. */
export function applyTxnsToState(agent, txns, { staleProvider = null, now = new Date() } = {}) {
  for (const t of txns) {
    const p = agent.providers.find((x) => x.provider === t.provider);
    const d = signedDelta(t);
    const wouldOverdraw =
      agent.cashBalance + d.cash < 0 || (p ? p.emoneyBalance + d.emoney < 0 : d.emoney !== 0);
    if (wouldOverdraw) {
      t.status = 'failed';
      t.failureReason = 'insufficient_funds';
    } else {
      agent.cashBalance += d.cash;
      if (p) p.emoneyBalance += d.emoney;
    }
    t.balanceAfter = { cash: agent.cashBalance, emoney: p ? p.emoneyBalance : 0 };
    // Feed freshness moves WITH the balance write — except the intentionally stale provider (Scenario C)
    if (t.provider !== staleProvider) agent.lastFeedAt.set(t.provider, now);
  }
  return txns;
}

export async function applyTxns(agent, txns, { staleProvider = null } = {}) {
  applyTxnsToState(agent, txns, { staleProvider, now: new Date() });
  await Transaction.insertMany(txns);
  await agent.save();
}

/* ---------- Alert upsert (dedup while open) ---------- */
const OPEN = ['new', 'acknowledged', 'in_progress', 'escalated'];
const REALERT_COOLDOWN_MIN = 10; // a just-resolved/dismissed case is not immediately re-raised
const KIND_BY_SUBTYPE = {
  cash_depletion: 'liquidity',
  emoney_depletion: 'liquidity',
  demand_surge: 'liquidity', // demand context — informs liquidity planning, not a review flag
  model_liquidity_risk: 'liquidity',
  model_unusual_review: 'anomaly',
  velocity_spike: 'anomaly',
  repeated_amount: 'anomaly',
  stale_feed: 'data_quality',
  missing_feed: 'data_quality',
  balance_mismatch: 'data_quality',
};
const ROUTE = { liquidity: 'field_officer', anomaly: 'ops', data_quality: 'ops' };
const EVIDENCE_HISTORY_CAP = 20;

async function upsertAlert(agent, finding) {
  const kind = KIND_BY_SUBTYPE[finding.subtype] || 'data_quality';
  const key = { agentId: agent.agentId, subtype: finding.subtype, provider: finding.provider ?? null };

  const existing = await Alert.findOne({ ...key, status: { $in: OPEN } });

  if (existing) {
    const severityChanged = existing.severity !== finding.severity;
    // Snapshot BEFORE overwrite — evidence updates must never erase the audit record.
    existing.evidenceHistory.push({ ts: new Date(), severity: existing.severity, confidence: existing.confidence, evidence: existing.evidence });
    if (existing.evidenceHistory.length > EVIDENCE_HISTORY_CAP) {
      existing.evidenceHistory = existing.evidenceHistory.slice(-EVIDENCE_HISTORY_CAP);
    }
    existing.evidence = finding.evidence;
    existing.confidence = finding.confidence;
    existing.severity = finding.severity;
    existing.riskScore = finding.riskScore ?? existing.riskScore;
    existing.confidenceScore = finding.confidenceScore ?? existing.confidenceScore;
    existing.dataConfidence = finding.dataConfidence ?? existing.dataConfidence;
    existing.riskBand = finding.riskBand ?? existing.riskBand;
    existing.modelType = finding.modelType ?? existing.modelType;
    existing.modelVersion = finding.modelVersion ?? existing.modelVersion;
    existing.featureSchemaVersion = finding.featureSchemaVersion ?? existing.featureSchemaVersion;
    existing.decisionSource = finding.decisionSource ?? existing.decisionSource;
    existing.triggeredRules = finding.triggeredRules ?? existing.triggeredRules;
    existing.dataFreshness = finding.dataFreshness ?? existing.dataFreshness;
    existing.predictionHorizonMin = finding.predictionHorizonMin ?? existing.predictionHorizonMin;
    existing.fallbackReason = finding.fallbackReason ?? existing.fallbackReason;
    if (severityChanged) {
      // Regenerate NL text only on severity change (compute-on-write, OpenAI once — not per poll)
      const ex = await generateExplanation(finding);
      Object.assign(existing, ex);
      existing.history.push({ actorRole: 'system', action: 'severity_changed', note: `→ ${finding.severity}` });
    }
    await existing.save();
    return { alert: existing, created: false };
  }

  // Cooldown: if the same condition was resolved/dismissed moments ago, don't
  // immediately re-open a new case — a human just handled it.
  const recentlyClosed = await Alert.findOne({
    ...key,
    status: { $in: ['resolved', 'dismissed'] },
    updatedAt: { $gte: new Date(Date.now() - REALERT_COOLDOWN_MIN * 60_000) },
  });
  if (recentlyClosed) return { alert: recentlyClosed, created: false, cooldown: true };

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
    riskScore: finding.riskScore ?? null,
    confidenceScore: finding.confidenceScore ?? finding.confidence,
    dataConfidence: finding.dataConfidence ?? finding.confidence,
    riskBand: finding.riskBand ?? 'unknown',
    modelType: finding.modelType ?? null,
    modelVersion: finding.modelVersion ?? null,
    featureSchemaVersion: finding.featureSchemaVersion ?? null,
    decisionSource: finding.decisionSource ?? 'rules_only',
    triggeredRules: finding.triggeredRules ?? [],
    dataFreshness: finding.dataFreshness ?? {},
    predictionHorizonMin: finding.predictionHorizonMin ?? null,
    fallbackReason: finding.fallbackReason ?? null,
    evidence: finding.evidence,
    possibleNormalReasons: finding.possibleNormalReasons || [],
    requiresReview: finding.requiresReview !== false,
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
  const txns = await Transaction.find({ agentId: agent.agentId, timestamp: { $gte: since, $lte: now } }).sort({ timestamp: 1 }).lean();
  const txnsByProvider = {};
  for (const p of agent.providers) txnsByProvider[p.provider] = [];
  for (const t of txns) (txnsByProvider[t.provider] ||= []).push(t);

  // Data quality FIRST — its issue map gates every forecast (dim + suppress).
  const { issuesByProvider, cashIssues, findings: dqFindings } = providerDataIssues(agent, txnsByProvider, now);
  const findings = [...dqFindings];

  // Liquidity
  for (const f of forecastAgent(agent, txnsByProvider, now, issuesByProvider, cashIssues)) {
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

  const decisionSupport = await evaluateDecisionSupport({ agent, transactions: txns, now, persistPredictions: true });
  const byProvider = new Map(decisionSupport.providerDecisions.map((decision) => [decision.provider, decision]));
  for (const finding of findings) {
    const decision = byProvider.get(finding.provider);
    const selected = finding.kind === 'anomaly' || ['velocity_spike', 'repeated_amount'].includes(finding.subtype)
      ? decision?.anomaly : decision?.liquidity;
    if (!selected) continue;
    finding.riskScore = selected.riskScore;
    finding.confidenceScore = selected.confidenceScore;
    finding.dataConfidence = selected.dataConfidence;
    finding.riskBand = selected.riskBand;
    finding.modelType = selected.model?.type || null;
    finding.modelVersion = selected.model?.version || null;
    finding.featureSchemaVersion = decision.features.schemaVersion;
    finding.decisionSource = selected.decisionSource;
    finding.triggeredRules = selected.triggeredRules;
    finding.dataFreshness = selected.dataFreshness;
    finding.predictionHorizonMin = 60;
    finding.fallbackReason = selected.fallbackReason;
    finding.confidence = selected.confidenceScore;
    finding.evidence = { ...finding.evidence, riskScore: selected.riskScore, confidenceScore: selected.confidenceScore, modelDriven: selected.mode === 'model_only' };
  }
  for (const decision of decisionSupport.providerDecisions) {
    const hasLiquidity = findings.some((finding) => finding.provider === decision.provider && ['cash_depletion', 'emoney_depletion'].includes(finding.subtype));
    const hasAnomaly = findings.some((finding) => finding.provider === decision.provider && ['velocity_spike', 'repeated_amount'].includes(finding.subtype));
    if (decision.liquidity.alert && decision.liquidity.mode === 'model_only' && !hasLiquidity) {
      findings.push({
        ...decision.liquidity,
        subtype: 'model_liquidity_risk', provider: decision.provider, severity: decision.liquidity.riskBand === 'critical' ? 'critical' : 'warning',
        confidence: decision.liquidity.confidenceScore, requiresReview: false,
        evidence: { provider: decision.provider, riskScore: decision.liquidity.riskScore, confidenceScore: decision.liquidity.confidenceScore, evidence: decision.liquidity.evidence },
      });
    }
    if (decision.anomaly.alert && decision.anomaly.mode === 'model_only' && !hasAnomaly) {
      findings.push({
        ...decision.anomaly,
        subtype: 'model_unusual_review', provider: decision.provider, severity: decision.anomaly.riskBand === 'critical' ? 'critical' : 'warning',
        confidence: decision.anomaly.confidenceScore, requiresReview: true,
        evidence: { provider: decision.provider, riskScore: decision.anomaly.riskScore, confidenceScore: decision.anomaly.confidenceScore, evidence: decision.anomaly.evidence },
      });
    }
  }

  const alertResults = [];
  for (const f of findings) alertResults.push(await upsertAlert(agent, f));
  return { findings, alertResults };
}

/* ---------- Tick loop ---------- */
async function tick() {
  if (state.ticking) return { skipped: true }; // a slow tick must not overlap the next one
  state.ticking = true;
  try {
    const agent = await Agent.findOne({ agentId: state.agentId });
    if (!agent) return { error: 'Agent not found' };
    const now = new Date();
    state.tickCount++;

    // Scenario C: break Rocket's feed IMMEDIATELY — backdate its last heartbeat past the
    // staleness threshold so the safe-fallback path demos in seconds, not in 10 real minutes.
    if (state.scenario === 'C' && state.tickCount === 1) {
      agent.lastFeedAt.set('Rocket', new Date(now.getTime() - (STALE_MIN + 2) * 60_000));
    }

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
  } finally {
    state.ticking = false;
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
  console.log('[sim] simulation started');
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
