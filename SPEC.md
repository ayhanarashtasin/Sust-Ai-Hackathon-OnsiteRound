# Super-Agent Liquidity & Risk Console — Executable Spec

> Decision-support prototype for multi-provider mobile-financial-service (MFS) agents.
> bKash presents SUST CSE Carnival 2026 (Codex Community Hackathon).
> **Advisory only. No real wallets, no real transactions, no fraud verdicts, synthetic data only.**

Status: ready to build · Stack: MERN · Team: 2–3 · Budget: ~10 hours · Platform: Web

---

## Context

A "super agent" outlet serves bKash, Nagad, and Rocket customers from **one physical cash drawer** but **three separate e-money balances**. Each provider app shows its own silo, so nobody can answer the one question that matters on Eid afternoon: *will this outlet have enough cash AND enough provider balance to keep serving customers for the next few hours?* Total value can look healthy while one provider's e-money or the shared cash reserve is about to hit zero. On top of that, a burst of near-identical cash-outs from a few accounts might be normal Eid demand, a data glitch, or something that needs review — and no one knows who should act first.

This prototype gives a **unified operational view**, forecasts **liquidity shortages before service breaks**, flags **unusual activity with evidence and uncertainty**, and drives a **traceable coordination case** to the right stakeholder. It never moves money, merges wallets, or declares fraud.

## Locked Decisions (from /spec interrogation)

| # | Decision | Choice | Rationale |
|---|----------|--------|-----------|
| D1 | Data engine | **Seed + live "Eid rush" streamer** | Historical baseline for anomaly comparison + live alerts firing during the demo. |
| D2 | AI layer | **OpenAI API + template fallback** | Structured evidence → NL bn/en/Banglish alert text; auto-falls back to templates if key missing/call fails so the live demo never breaks. |
| D3 | Anomaly method | **Statistical rules in Node** | z-score velocity + repeated-amount clustering. Explainable, evidence-rich, no extra service, fits MERN + 10h. |
| D4 | Roles/auth | **Real JWT staff login** | agent / field_officer / ops / risk / management. Scoped access drives the coordination story. **Staff login only — never customer PIN/OTP.** |
| D5 | Providers | **bKash, Nagad, Rocket (3)** | Exceeds the ≥2 requirement; realistic. |

---

## Mandatory-Requirement Traceability

Every mandatory item from the brief (§7 + §16) maps to a concrete feature. Nothing is left implicit.

| ID | Mandatory requirement | Feature | Acceptance criterion # |
|----|----------------------|---------|------------------------|
| M1 | Shared cash + separate provider balances | Unified balance view (1 cash drawer + 3 provider bars) | AC-1 |
| M2 | Which provider/cash faces shortage & approx. when | Burn-rate forecast → depletion ETA + confidence | AC-2 |
| M3 | ≥1 unusual activity + why | z-score velocity + repeated-amount clustering w/ evidence | AC-3 |
| M4 | Careful language, no fraud claim | Fixed vocabulary ("unusual" / "requires review"); lint check | AC-4 |
| M5 | Alert: receiver, owner, next step, final status | Case lifecycle: route → ack → escalate/resolve + timeline | AC-5 |
| M6 | Lower confidence / fallback on bad data | Stale-feed + balance-mismatch detector → confidence dimming + banner | AC-6 |
| M7 | AI/analytics as meaningful core | Forecast + anomaly engines + OpenAI NL explanations | AC-7 |

---

## Data Model (MongoDB / Mongoose)

All records carry `simulated: true` and a `SIMULATED DATA` badge renders in the UI.

### `users` (staff — JWT auth)
```js
{
  _id, name, email (unique), passwordHash,
  role: 'agent' | 'field_officer' | 'ops' | 'risk' | 'management',
  area: String,                          // scoping: field_officer sees their area
  providerScope: ['bKash','Nagad','Rocket'] | ['all'], // ops teams are provider-specific
  agentId: ObjectId | null,              // set when role === 'agent'
  createdAt
}
```
Access rules: `agent` sees own outlet; `field_officer` sees agents in `area`; `ops` sees `providerScope` across areas; `risk` sees escalated alerts; `management` read-only area rollups.

### `agents` (outlets)
```js
{
  _id, agentId (unique), name, area, thana, district,
  cashBalance: Number,                   // shared physical cash drawer (BDT)
  cashFloorThreshold: Number,            // safe minimum cash
  providers: [{
    provider: 'bKash'|'Nagad'|'Rocket',
    emoneyBalance: Number,
    openingBalance: Number,
    floorThreshold: Number
  }],
  lastFeedAt: { bKash: Date, Nagad: Date, Rocket: Date }, // staleness detection
  createdAt, updatedAt
}
```

### `transactions`
```js
{
  _id, txnId (unique), agentId, provider,
  type: 'cash_in'|'cash_out'|'send_money'|'payment'|'b2b_topup',
  amount: Number, status: 'success'|'failed'|'pending',
  customerHash: String,                  // synthetic anonymized id — NOT a real identity
  timestamp: Date,
  balanceAfter: { cash: Number, emoney: Number }, // audit snapshot
  simulated: Boolean                     // always true
}
```
**Balance direction (MFS agent model):**
- `cash_out` (customer withdraws): agent **cash ↓**, agent provider **emoney ↑**. → drains physical cash.
- `cash_in` (customer deposits): agent **cash ↑**, agent provider **emoney ↓**. → drains that provider's e-money.

So a "hidden shortage" can be *either* physical cash (cash-out heavy) *or* one provider's e-money (cash-in heavy). Both are modeled.

### `alerts`
```js
{
  _id, alertId (unique), agentId, area,
  kind: 'liquidity'|'anomaly'|'data_quality',
  provider: 'bKash'|'Nagad'|'Rocket'|null, // null = shared cash / aggregate
  subtype: 'cash_depletion'|'emoney_depletion'|'velocity_spike'|'repeated_amount'|'stale_feed'|'balance_mismatch',
  severity: 'info'|'warning'|'critical',
  confidence: Number,                    // 0..1
  title_en, title_bn, message_en, message_bn, message_banglish,
  recommendedNextStep_en, recommendedNextStep_bn,   // next step includes computed suggestedTopUp amount
  evidence: Object,                      // structured, see engines below
  routedToRole, ownerUserId: ObjectId|null,
  status: 'new'|'acknowledged'|'in_progress'|'escalated'|'resolved'|'dismissed',
  history: [{ ts, actorUserId, actorRole, action, note }],
  createdAt, updatedAt, resolvedAt
}
```

---

## Analytics Engines (Node, deterministic, testable)

### 1. Liquidity forecast (M2) — `services/forecast.js`
Runs per resource: shared cash + each provider e-money.
```
window W = 30 min
netFlow  = Σ signed deltas of txns in W   (cash_out drains cash; cash_in drains emoney)
burnRate = -netFlow / W                    (BDT/min; only when draining, burnRate > 0)
timeToDepletion  = (currentBalance - floorThreshold) / burnRate   (minutes)
projectedDepletionAt = now + timeToDepletion
confidence = 0.9
           - 0.3 if sampleSize < 10
           - 0.2 if coefficientOfVariation(rates) > 0.5
           - 0.3 if feed is stale (see engine 3)   (floor at 0.1)
Alert:  timeToDepletion < 120min → warning ;  < 30min → critical
suggestedTopUp = max(0, burnRatePerMin × 120 − (currentBalance − floorThreshold)), rounded up to ৳1,000
```
`suggestedTopUp` goes into `recommendedNextStep` — a concrete number ("arrange at least ৳20,000 extra cash"), matching the brief's illustrative alert. Quantified advice, not vibes.
`evidence = { resource, currentBalance, floorThreshold, burnRatePerMin, sampleSize, projectedDepletionAt, windowMin: W }`

### 2. Anomaly detection (M3) — `services/anomaly.js`
Two independent detectors, each emits its own evidence. Language is always "unusual / requires review."
- **Velocity spike:** count `cash_out` per rolling 5-min bucket per provider. Baseline mean/std from historical same-hour buckets. `z = (current - mean)/std`. Flag `z > 3`.
  `evidence = { provider, bucketCount, baselineMean, baselineStd, zScore, involvedTxnIds }`
- **Repeated / near-identical amount:** within W, group `cash_out` by rounded amount. Flag if an amount appears **≥5 times** from **≤3 distinct `customerHash`**.
  `evidence = { amount, repeatCount, distinctAccounts, involvedTxnIds }`
- Every anomaly alert includes `possibleNormalReasons: ["Pre-Eid cash-out demand", "salary-day spike", "data delay"]` and `requiresReview: true`. **Never** the word "fraud."

### 3. Data-quality / fallback (M6) — `services/dataQuality.js`
- **Stale feed:** `now - lastFeedAt[provider] > 10min` → mark provider forecasts low-confidence + UI banner.
- **Balance mismatch:** `|openingBalance + computedNetFlow - currentBalance| > tolerance` → `data_quality` alert, keep provider balances **separate**, lower confidence, suppress any recommendation that depends on the bad feed.
  `evidence = { provider, expected, actual, deltaAbs, tolerance }`

### 4. Explanation layer (M7) — `services/explain.js`
`generateExplanation(evidence, role, lang) → { title, message, nextStep }`
- Primary: OpenAI Chat Completions. System prompt enforces careful language, provider separation, advisory-only, no fraud claims, role-appropriate tone.
- Fallback: deterministic bn/en templates (fires on missing `OPENAI_API_KEY`, timeout > 4s, or API error). Fallback path is logged so the demo can prove graceful degradation.

---

## API (Express, JWT-guarded)

```
POST /api/auth/register            (seed/admin only)
POST /api/auth/login → { token }
GET  /api/auth/me

GET  /api/agents                   (role-scoped list)
GET  /api/agents/:id               (unified balances + health score)
GET  /api/agents/:id/transactions  ?provider=&from=&to=
GET  /api/agents/:id/forecast      (per-resource depletion ETA + confidence)
GET  /api/agents/:id/anomalies     (current anomaly signals)

GET  /api/alerts                   ?status=&provider=&area=&kind=
GET  /api/alerts/:id
POST /api/alerts/:id/acknowledge
POST /api/alerts/:id/assign        { userId }
POST /api/alerts/:id/escalate      { toRole, note }
POST /api/alerts/:id/resolve       { note }
POST /api/alerts/:id/note          { note }

POST /api/sim/start                { agentId, scenario:'A'|'B'|'C'|'D', speed }
POST /api/sim/stop
```
Live updates: client polls `/api/alerts` and `/api/agents/:id/forecast` every **3s** via React Query `refetchInterval` (reliable for demo). Socket.IO push is an optional upgrade, not core.

---

## Frontend (React + Vite)

- **Login** (JWT) → role-scoped dashboard.
- **Unified balance hero:** one cash drawer + 3 provider bars + a single "Liquidity Health" line that combines them. Highlights the hidden-shortage case (total healthy, one resource dying).
- **Forecast panel:** per-resource depletion timeline + confidence meter (dims on bad data).
- **Alerts feed:** liquidity + anomaly + data-quality, each expandable to evidence + uncertainty + bn/en message + safe next step.
- **Case view:** owner, recommended next step, status badges, ack/escalate/resolve buttons, full history timeline.
- **Filters:** provider / area / time.
- **bn/en toggle**, `SIMULATED DATA` badge, and an **"Eid rush"** button (calls `/api/sim/start`).

The connective tissue (the 20% innovation score): anomaly-inflated cash-out **feeds the burn rate → shortens the depletion ETA → raises a coordinated case.** Show that causal chain explicitly on screen.

---

## Demo Scenarios (map to brief §11)

- **A — Hidden provider shortage:** total looks fine; Nagad e-money ETA ~5:20pm. Forecast panel + confidence.
- **B — Liquidity + unusual activity:** cash draining fast + repeated-amount burst on bKash. Shows both, plus "may be normal Eid demand," recommends review before big cash top-up. **Contrast seed:** alongside it, a normal Eid burst (high volume, varied amounts, many distinct accounts) that stays *unflagged* — a live "we don't cry wolf" false-positive demonstration.
- **C — Data inconsistency:** Rocket feed stale/conflicting → confidence drops, banner, balances stay separate, no misleading recommendation.
- **D — Coordinated closure:** critical alert → routed to field_officer → acknowledged → escalated to risk → resolved, with visible timeline.

---

## Acceptance Criteria (pass/fail)

1. **AC-1** Dashboard shows shared physical cash and all 3 provider e-money balances distinctly, for a selected agent, with a combined total.
2. **AC-2** For an agent under pressure, the forecast names the specific resource (cash or a provider), a projected depletion time, and a confidence value; alerts at <120min (warning) and <30min (critical).
3. **AC-3** At least one anomaly type fires on injected Scenario B and exposes evidence (the involved transaction IDs + the numeric reason: z-score or repeat/distinct counts).
4. **AC-4** No alert anywhere uses "fraud"/"fraudulent"/accusatory language; all risk copy uses "unusual"/"requires review." Enforced by a unit test scanning alert output.
5. **AC-5** For a critical alert: it is routed to a role, assignable to a user, acknowledgeable, escalatable to risk, and resolvable — and the history timeline records each transition with actor + timestamp.
6. **AC-6** On Scenario C (stale/conflicting feed), the affected provider's confidence drops, a data-quality banner shows, provider balances remain separate, and no recommendation is issued off the bad feed.
7. **AC-7** Every high-impact alert carries a bn AND en message; OpenAI generates them when the key is present, template fallback when not (prove by unsetting the key).
8. **AC-8** All data is labeled `SIMULATED`; no customer PIN/OTP/password field exists anywhere.
9. Tests written and passing for the three engines. No regression of existing functionality.

---

## Validation Metrics (≥3 required — brief §10/§12)

| Metric | Method | Target |
|--------|--------|--------|
| Shortage detection lead time | Injected Scenario A; measure minutes between first alert and simulated depletion | ≥ 15 min median |
| Anomaly precision & recall | 20 injected anomalous bursts + 20 normal bursts | precision ≥ 0.80, recall ≥ 0.80 |
| False-positive rate | Normal salary-day/Eid burst with no injected anomaly | ≤ 10% flagged |
| API latency p50/p95 | `autocannon` over core endpoints at seeded volume | p95 < 300 ms |
| Alert explanation coverage | % alerts carrying reason + evidence + uncertainty | 100% |

Ship the metrics as a `npm run validate` script that prints the table — it doubles as validation evidence in the deck.

---

## Testing Plan

| Layer | What | Count |
|-------|------|------:|
| Unit | `forecast.timeToDepletion`, `anomaly.zScore`, `anomaly.repeatCluster`, `dataQuality.mismatch`, careful-language lint | +8 |
| Integration | login→scoped agents; scenario B → anomaly alert; alert ack→escalate→resolve lifecycle; stale feed → confidence drop | +4 |
| E2E (manual, scripted) | Login → open agent → Eid rush → alert fires → coordinate to resolution | +1 |

---

## Architecture Hardening (from /plan-eng-review)

Three load-bearing decisions from the eng review, applied to the plan below:

1. **Vertical slice, not horizontal layers.** Build one agent → balances → forecast → anomaly → one case-to-resolution end-to-end by ~hour 5 (the "demo spine"), THEN thicken (JWT, more scenarios, filters). Guarantees a demoable product even at 60% completion. JWT is deferred off the critical path (still built, ~5:30).
2. **Compute-on-write, not compute-on-read.** The sim tick recomputes forecast+anomaly, generates each alert's NL text once (OpenAI or template), and writes alerts + balances atomically. The 3s client poll only READS. → no flicker, OpenAI called once per alert (not per poll), no request-path latency, and a **single atomic balance writer** so the balance-mismatch detector only fires on injected Scenario C, never on our own bug.
3. **Careful-language runtime guard (enforces AC-4).** Every alert message passes `assertSafeLanguage(text)` before save/display. Banned words (fraud/fraudulent/guilty/accused/…) → reject and use the safe template. Wraps BOTH the OpenAI and template paths (OpenAI output is non-deterministic). Backed by a unit test feeding known-bad text.

**Folded-in minor fixes:** (a) index `transactions` on `{agentId, provider, timestamp}` — the window scans hit it every tick; (b) one shared `signedDelta(txn)` util used by the seed generator, sim tick, and forecast so cash/e-money drain direction can't drift; (c) AC-7 test: unset `OPENAI_API_KEY` → assert template fallback renders.

## 10-Hour Execution Plan (3 streams; if 2 people, C folds into A & B)

**A = Backend/Analytics · B = Frontend · C = Data/Integration/Docs/Demo**

```
Dependency graph:
  Schema+contract ─┬─> Data generator (C) ─┬─> Forecast/Anomaly engines (A) ─> Alerts
                   ├─> Read APIs (A) ───────┘                                    │
                   └─> UI shell (B) ─> Balance hero ─> Alerts feed ─> Case view ─┘
  JWT auth (A) ──> role scoping (A) ──> login UI (B)   [parallel, early-cut candidate]
```

Ordering follows the **vertical slice** rule: the demo spine (bold **SPINE**) must work end-to-end by ~hour 5. JWT and enhancements come after.

| Time | A (backend/analytics) | B (frontend) | C (data/sim/docs) |
|------|-----------------------|--------------|-------------------|
| 0:00–0:45 | Scaffold Express+Mongoose; agree schema + API contract; add txn index `{agentId,provider,timestamp}` | Vite React shell, router, API client, React Query | Repo init, README skeleton, Mongo (Atlas/local) |
| 0:45–2:30 | **SPINE:** models + read endpoints (agent/balances/txns); `signedDelta` util | **SPINE:** unified **balance hero** for one agent (no login yet) | **SPINE:** data generator + seed ONE agent w/ Scenario A+B history |
| 2:30–4:30 | **SPINE:** forecast + anomaly engines; **sim tick = compute-on-write** (recompute → write alerts/balances + NL text) | **SPINE:** forecast panel + alerts feed w/ evidence; "Eid rush" button | **SPINE:** sim streamer wired; `assertSafeLanguage` guard |
| 4:30–5:30 | **SPINE:** alert lifecycle (ack/escalate/resolve) + history | **SPINE:** case view + timeline + actions | Wire Scenario D e2e → **demo spine complete ✓** |
| 5:30–7:00 | JWT auth + role scoping (1st enhancement) + data-quality/fallback | Login + role-scoped views; bn/en toggle + Bangla alerts | Scenario C; start `npm run validate` |
| 7:00–8:30 | `explain.js` (OpenAI, guard-wrapped) + template fallback; filters | Filters + polish; confidence-dimming UI | Run validate; screenshots; language-guard + fallback unit tests |
| 8:30–9:30 | Bug-fix, API docs | UI freeze | Architecture diagram, data-sim note, responsible-design note |
| 9:30–10:00 | On-call | On-call | Slide deck + **rehearse the live Eid-rush flow once** |

**Effort estimate:** ~1.5h auth · ~2h engines · ~2h coordination · ~1.5h data+sim · ~1h AI+fallback · ~1h docs · ~1h polish/rehearsal.

**Cut order if behind:** Socket.IO (already optional) → filters → bn OpenAI (keep templates) → **JWT (drop to role switcher)** → trim to Scenarios B + D. **Never cut:** unified balances, one forecast, one anomaly-with-evidence, one full case lifecycle, data-quality fallback, 3 metrics, README/architecture/responsible note.

---

## Responsible Design / Guardrails (brief §14 — cheap points, easy to lose)

- Careful language only; **no fraud verdicts** (AC-4, enforced by test).
- Providers are **logically separate**; never imply conversion/settlement/transfer between wallets.
- **No customer PIN/OTP/password/private-key fields.** JWT is **staff console login**, a different thing from customer wallet credentials. The §6 out-of-scope "collection of credentials" targets customer authentication data. Make this explicit in two places: a login-screen note ("Demo staff login — seeded accounts; no customer credentials are ever collected") and a paragraph in `docs/responsible-design.md`. If challenged, the cut-order path (drop to role switcher) erases the surface entirely.
- Risk signals are **advisory**; every one requires human review. Escalation raises an *authorized support request*, never a liquidity transfer.
- All data labeled **synthetic**; documented assumptions, injected patterns, and expected false positives.
- No auto-block, no accusation, no financial action.

## Deliverables Checklist (brief §10/§16)

- [ ] Working prototype: multi-provider balances + a live liquidity/anomaly alert + one coordinated case to closure
- [ ] Source repo: code, README, setup, `.env.example`, sample data
- [ ] Architecture diagram (interfaces, backend, data flow, analytics, provider boundaries, alert flow)
- [ ] Data & simulation note (how synthetic data + scenarios were built; assumptions; limitations)
- [ ] Validation evidence: ≥3 measured metrics (`npm run validate` output)
- [ ] Responsible-design note (privacy, human review, false positives, what it intentionally does NOT do)
- [ ] Final presentation (problem, users, story demo, architecture, metrics, coordination flow, risks, limits, next steps)

## Out of Scope

- Real interoperability/settlement/conversion between bKash, Nagad, Rocket.
- Production APIs, real customer identities, real balances/accounts.
- Auto-block, accusation, disciplinary action, final fraud determination.
- Unauthorized cash movement, wallet refill, transfer, recovery, reversal.
- Collecting PINs/OTPs/passwords/keys.
- Claims of regulatory approval or production fraud-detection readiness.
- Native Android app (web only for this build).

## Files Reference (target structure)

| File | Purpose |
|------|---------|
| `server/models/{User,Agent,Transaction,Alert}.js` | Mongoose schemas |
| `server/services/{forecast,anomaly,dataQuality,explain}.js` | Analytics + AI |
| `server/routes/{auth,agents,alerts,sim}.js` | Express routes |
| `server/middleware/auth.js` | JWT verify + role scoping |
| `server/scripts/seed.js` | Synthetic data generator + 4 scenarios |
| `server/scripts/validate.js` | Metrics harness (`npm run validate`) |
| `client/src/pages/{Login,Dashboard,AgentDetail,CaseView}.jsx` | Screens |
| `client/src/components/{BalanceHero,ForecastPanel,AlertsFeed,CaseTimeline}.jsx` | UI |
| `client/src/i18n/{en,bn,banglish}.js` | Trilingual strings (Banglish templates are near-free since alert text is templated/generated anyway) |
| `.env.example` | `MONGO_URI`, `JWT_SECRET`, `OPENAI_API_KEY` (optional) |
| `README.md`, `docs/architecture.md`, `docs/data-simulation.md`, `docs/responsible-design.md` | Deliverable docs |

## GSTACK REVIEW REPORT

| Review | Trigger | Why | Runs | Status | Findings |
|--------|---------|-----|------|--------|----------|
| Eng Review | `/plan-eng-review` | Architecture & feasibility (required) | 1 | issues_folded | 3 load-bearing + 3 minor, all applied |

**Findings folded into the plan:**
- **[P1] Vertical slice, JWT deferred** — build order was horizontal (risk: nothing demoable). Now spine-first by ~hour 5.
- **[P1] Compute-on-write** — analytics + OpenAI text run on the sim tick, not on every 3s poll. Removes flicker, rate-limit risk, request-path latency; gives a single atomic balance writer.
- **[P1] Careful-language runtime guard** — `assertSafeLanguage` wraps both OpenAI and template output to enforce AC-4 against non-deterministic LLM text.
- **[P2] minor** — txn index `{agentId,provider,timestamp}`; shared `signedDelta` util; AC-7 fallback test.

**Feasibility verdict:** full scope ≈ 20–30 eng-hours vs 20–30 person-hours available before overhead → expect ~60–70% landed. The vertical-slice reorder makes that 60–70% a **complete, demoable product** rather than three half-finished layers. 10 hours is realistic *for the spine + a subset of enhancements*, not for 100% of the original scope.

**Failure modes flagged (spine codepaths):**
- Sim tick writes balance but not txn (or vice versa) → false balance-mismatch alert. Mitigated by single atomic writer. Needs a test.
- OpenAI timeout/rate-limit mid-demo → template fallback (must be the default path, OpenAI async on tick). Covered.
- Empty transaction window → `burnRate = 0` → divide-by-zero on `timeToDepletion`. Guard: return "no drain / stable" when `burnRate <= 0`. **Add this test.**

**NOT in scope (deferred, with rationale):** Socket.IO push (polling is enough for demo) · ML anomaly (statistical is explainable + fits clock) · multi-agent area rollups beyond seed (management view is read-only stretch) · native Android (web only) · real auth hardening/refresh tokens (staff login is demo-grade).

**What already exists:** nothing — greenfield repo (`D:\Sust_Hackathon` had only `.claude/`). No reuse; all components built fresh.

**Parallelization:** Lane A (backend/analytics) and Lane B (frontend) run in parallel off the shared schema+API contract; Lane C (data/sim/docs) feeds both. Converge at the spine checkpoint (~hour 5). JWT is an independent later lane. If 2 people: merge C into A+B.

**VERDICT:** ENG REVIEW CLEARED — architecture hardened, feasibility bounded, plan ready to implement (spine-first).

NO UNRESOLVED DECISIONS
