# Super-Agent Liquidity & Risk Console

Decision-support prototype for multi-provider mobile-financial-service (MFS) super agents — built for **bKash presents SUST CSE Carnival 2026 (Codex Community Hackathon)**.

> **SIMULATED DATA ONLY.** This prototype never connects to real wallets, never moves money, never collects customer credentials, and never makes fraud determinations. All risk signals are advisory and require human review.

---

## Problem

A "super agent" outlet serves bKash, Nagad, and Rocket customers from **one shared physical cash drawer** but **three separate e-money balances**. Each provider app shows only its own silo — no one can answer the critical question on an Eid afternoon:

> *Will this outlet have enough cash AND enough e-money balance per provider to keep serving customers for the next few hours?*

Total balance can look healthy while one provider's e-money is minutes from zero. A burst of near-identical cash-outs from a few accounts might be normal Eid demand, a data glitch, or something requiring human review — and no one knows who should act first.

---

## What it does

1. **Unifies the view** — one shared cash drawer + three separate provider e-money bars on one screen. Providers are never merged or converted — separation is enforced server-side on every endpoint.
2. **Forecasts shortages** — burn-rate projection per resource: which provider or the cash drawer runs short, when, with what confidence, and a quantified top-up suggestion (rounded to ৳1,000).
3. **Flags unusual activity with evidence** — z-score velocity spike with concentration classification (a diverse Eid rush is labeled `demand_surge`, not flagged for review) + repeated near-identical amounts via tolerance clustering. Careful language only — enforced by a runtime guard.
4. **Coordinates the response** — alerts route to a role, get acknowledged, assigned to a named owner, escalated (authorized support request), and resolved through a validated state machine with a full audit timeline.
5. **Fails safe on bad data** — stale, missing, or conflicting provider feeds lower confidence, show a banner, and withhold the top-up recommendation. Bad data never produces a confident recommendation.

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| **Frontend** | React 18.3.1, React Router DOM 6.24, Vite 5.3.3 |
| **Real-time** | Socket.io 4.8.3 (client + server) |
| **Backend** | Node.js ≥ 18, Express 4.19.2 |
| **Database** | MongoDB (Mongoose 8.5.1) — local or Atlas |
| **Auth** | JWT (jsonwebtoken 9.0.2) + bcryptjs 2.4.3 |
| **ML inference** | ONNX Runtime Node 1.27.0 (pre-trained LightGBM/XGBoost) |
| **ML training** | Python 3.11, LightGBM 4.3, XGBoost 2.0, scikit-learn 1.4, ONNX 1.16 |
| **NL generation** | OpenAI gpt-4o-mini (4 s timeout, JSON mode) + deterministic fallback templates |
| **CI** | GitHub Actions + SonarCloud |
| **i18n** | English / Bengali / Banglish (trilingual, persists across page loads) |

---

## Quick Start

**Prerequisites:** Node ≥ 18, MongoDB (local `mongod` or Atlas URI).

```bash
# Server
cd server
npm install
cp ../.env.example .env     # set MONGO_URI, JWT_SECRET (required); OPENAI_API_KEY (optional)
npm run seed                # load deterministic synthetic data (SEED=20260711 by default)
npm start                   # API on :5000

# Client — new terminal
cd client
npm install
npm run dev                 # UI on :5173 (Vite proxies /api → :5000)
```

### Environment variables

**Required:**

| Variable | Purpose |
|----------|---------|
| `MONGO_URI` | MongoDB connection string (local or Atlas) |
| `JWT_SECRET` | Signing key for staff JWTs (any long random string) |

**Optional — features:**

| Variable | Default | Purpose |
|----------|---------|---------|
| `OPENAI_API_KEY` | — | GPT-4o-mini alert prose; falls back to templates if absent |
| `SEED` | `20260711` | PRNG seed for `npm run seed` |
| `PORT` | `5000` | API port |
| `CLIENT_ORIGIN` | `http://localhost:5173` | CORS allowed origins |
| `MONGO_DB_NAME` | `superagent` | Database name |
| `MONGODB_DNS_SERVERS` | — | Fallback DNS for Atlas DNS failures |

**Optional — ML & decision engine:**

| Variable | Default | Purpose |
|----------|---------|---------|
| `ML_ENABLED` | `true` | Enable ONNX model inference |
| `MODEL_TYPE` | `lightgbm` | `lightgbm` \| `xgboost` |
| `MODEL_DIR` | `../ml/artifacts` | Directory containing ONNX model artifacts |
| `FEATURE_WINDOWS_MINUTES` | `5,15,30,60` | Rolling window sizes for feature extraction |
| `DATA_FRESHNESS_MINUTES` | `10` | Max age before `stale_feed` flag |
| `LIQUIDITY_MODEL_THRESHOLD` | `0.65` | Model probability threshold (liquidity shortage) |
| `ANOMALY_MODEL_THRESHOLD` | `0.70` | Model probability threshold (unusual activity) |
| `MEDIUM_RISK_THRESHOLD` | `0.45` | Risk score band boundary |
| `HIGH_RISK_THRESHOLD` | `0.70` | Risk score band boundary |
| `CRITICAL_RISK_THRESHOLD` | `0.90` | Risk score band boundary |
| `CASH_BURN_RATE_THRESHOLD` | `500` | BDT/min hard-safety rule trigger |
| `VELOCITY_RATIO_THRESHOLD` | `2.5` | Multiplier for anomaly rule |
| `REPEATED_AMOUNT_COUNT` | `5` | Minimum cluster size for repeated-amount flag |
| `SMALL_ACCOUNT_COUNT` | `3` | Max distinct accounts for concentration check |
| `HIGH_VALUE_AMOUNT` | `10000` | Transaction amount for high-value classification |

### Demo staff accounts

Password `demo1234` for all. These are staff console logins — no customer credentials are collected anywhere.

| Email | Role | Scope |
|-------|------|-------|
| `agent@demo.test` | agent | Own outlet (AGT-001) only — other outlets return 404 |
| `field@demo.test` | field_officer | Agents in Amberkhana area; receives and works liquidity alerts |
| `ops@demo.test` | ops | All areas + all providers; receives anomaly and data-quality alerts |
| `risk@demo.test` | risk | Escalated cases only |
| `mgmt@demo.test` | management | Read-only area overview — every mutation route returns 403 |

---

## Demo Scenarios

Open AGT-001 after seeding. Select a scenario and press **Eid rush** (continuous, 2 s/tick) or **Step** (one tick at a time for a controlled walkthrough).

| Scenario | What is injected | What to watch |
|----------|-----------------|--------------|
| **A — Hidden provider shortage** | Steady Nagad-heavy `cash_in` drains Nagad e-money while total balance looks fine | Forecast panel: Nagad bar turns warning/critical; shared cash stays green. Shows the hidden-shortage problem directly. |
| **B — Liquidity + unusual activity** | bKash repeated-amount burst (few accounts, near-identical amounts) + Rocket diverse Eid burst (many accounts, varied amounts) | bKash anomaly alert fires; Rocket is classified `demand_surge` (info — not a review flag). The causal chain: anomaly inflates cash-out rate → shortens liquidity ETA → raises coordinated case. |
| **C — Data inconsistency** | Rocket feed backdated (stale on tick 1) + balance nudged off-book (mismatch by tick 5) | Confidence dims; data-quality banner appears; top-up recommendation withheld for Rocket and shared cash; provider balances remain separate. |
| **D — Coordinated response** | Scenario B at critical volume | Open the alert → acknowledge → assign owner → escalate to risk → resolve. The state machine rejects re-acknowledging a resolved case (409). Audit timeline records every actor by name. |

**Language toggle:** every alert title, message, and next step is fully trilingual — EN / বাংলা / Banglish. The choice persists across page loads.

---

## Architecture

```
┌──────────────────────── Browser (React 18 + Vite) ─────────────────────────┐
│                                                                              │
│  Login → Dashboard → AgentDetail → CaseView                                 │
│                                                                              │
│  Polls every 3 s (alerts, forecast, decision)  /  5 s (agents, model status)│
│  Socket.io for push-based live updates                                       │
│  Client is READ-ONLY in the request path — no alert writes, no OpenAI calls │
└────────────────────────────┬─────────────────────────────────────────────────┘
                             │ REST + JWT  /  Socket.io
┌────────────────────────────▼─────────────────────────────────────────────────┐
│                        Express API (:5000)                                   │
│                                                                              │
│  middleware/auth.js   JWT verify → role + area + providerScope on req.user  │
│                                                                              │
│  routes/              role gates (management blocked from all mutations)     │
│    authRoutes         POST /login  GET /me                                   │
│    agentRoutes        GET /agents  GET /agents/:id  GET /agents/:id/forecast │
│    alertRoutes        GET /alerts  GET /alerts/:id  POST /:id/{action}       │
│    simRoutes          POST /sim/start|stop|step|reset  GET /sim/status       │
│    modelRoutes        GET /model/status                                      │
│    publicRoutes       GET /health                                            │
│                                                                              │
│  controllers/                                                                │
│    alertController    visibilityScope() enforced on every read + write       │
│    simController      role-scoped sim control; management blocked            │
│    authController     staff bcrypt login; in-memory throttle (10 fails/15m) │
│    decisionController GET /agents/:id/decision-support                      │
└────────────────────────────┬─────────────────────────────────────────────────┘
                             │ compute-on-write (sim tick, 2 s)
┌────────────────────────────▼─────────────────────────────────────────────────┐
│                    Sim Engine  (services/simEngine.js)                       │
│                                                                              │
│  Every tick:                                                                 │
│    1. Generate scenario transactions (A / B / C / D)                        │
│    2. applyTxns() — single atomic agent document save (balance-writer)       │
│    3. evaluateDecisionSupport() — full analytics pipeline (see below)        │
│    4. Upsert alerts — dedup on agentId + subtype + provider while open       │
│       NL text generated ONCE per alert creation or severity change           │
└──────────────────────────────────────────────────────────────────────────────┘

                    ┌──── evaluateDecisionSupport() ────┐
                    │  (services/ml/decisionSupport.js)  │
                    └──────────────┬────────────────────┘
                                   │ per provider
          ┌────────────────────────┼──────────────────────────────┐
          ▼                        ▼                              ▼
  dataQuality.js          featurePipeline.js              forecast.js
  checkStaleFeeds()       buildFeatureSnapshot()          forecastAgent()
  checkBalanceMismatch()  → feature vector + schema        per resource:
  → issuesByProvider        version for audit trail          cash + 3× emoney
  → cashIssues                                            burn rate · ETA ·
                                   │                       confidence · topup
                                   ▼
                          modelRuntime.js
                          predictModel('liquidity_shortage_60m')
                          predictModel('unusual_activity_review')
                          → { available, probability, modelType,
                              modelVersion, validationPrAuc }
                          (falls back gracefully when artifact missing)
                                   │
                          ruleEngine.js + ruleDefinitions.js
                          runRuleEngine()
                          → { hardSafety, anomalyEvidence,
                              dataQuality, triggered,
                              hasCriticalOverride }
                                   │
                          hybridDecision.js
                          combineDecisions()
                          → riskScore · riskBand · confidenceScore ·
                             dataConfidence · decisionSource ·
                             decisionMode · fallbackReason
                          Modes: critical_override | model_rule_agreement
                                 | model_only | rule_only | none
                                   │
                          evidenceMapper.js
                          readableEvidence() + dataFreshness()
                                   │
                          anomaly.js (statistical, per provider)
                          detectVelocitySpike()   z-score, concentration class
                          detectRepeatedAmounts() tolerance clustering
                          → velocity_spike | demand_surge | repeated_amount
                                   │
                          explain.js
                          generateExplanation()
                          → OpenAI gpt-4o-mini (4 s timeout, JSON mode)
                             OR deterministic bn/en/Banglish templates
                          Every field passes languageGuard.assertSafeLanguage()
                          before save — banned words reject the whole result
                                   │
                                   ▼
                              MongoDB (Mongoose)
                    Agent · Transaction · Alert · Prediction · User
```

### Key architectural decisions

| Decision | Choice | Reason |
|----------|--------|--------|
| Compute-on-write | Sim tick runs all analytics + NL text once; client polls read only | No flicker, OpenAI called once per alert (not per poll), no request-path latency |
| Single balance-writer | One atomic agent document save per tick | Prevents false `balance_mismatch` alerts from our own code |
| Language guard | Runtime `assertSafeLanguage()` wraps both OpenAI and template output | OpenAI is non-deterministic; the prompt alone is not enforcement |
| Safe fallback | Any data issue → `recommendationSuppressed = true`, `suggestedTopUp = 0` | Bad data must lower claims, never raise them |
| Provider isolation | `visibilityScope()` in alertController enforces role + area + providerScope on every DB query | Provider boundaries are enforced server-side, not just displayed |
| Hybrid ML + rules | ONNX model probability combined with deterministic rule engine | Rules enforce hard safety; model catches softer patterns; neither alone is sufficient |

---

## Analytics Engines

### 1. Liquidity Forecast (`services/forecast.js`)

Runs independently for shared cash and each provider's e-money.

```
window W = 30 min
netFlow     = Σ signedDelta(txn) over W
burnRate    = −netFlow / W          BDT/min  (0 when not draining)
headroom    = currentBalance − floorThreshold
timeToDepl  = headroom / burnRate

confidence starts at 0.9
  − 0.3  if sampleSize < 10
  − 0.2  if CV(per-bucket rates) > 0.5
  − 0.3 / 0.4 / 0.2  per stale_feed / missing_feed / balance_mismatch issue
  floor 0.1

status: critical  if timeToDepl < 30 min
        warning   if timeToDepl < 120 min
        ok / stable otherwise

suggestedTopUp = ceil( max(0, burnRate × 120 − headroom) / 1000 ) × 1000
               = 0 when any data issue exists (recommendationSuppressed)
```

### 2. Anomaly Detection (`services/anomaly.js`)

**Velocity spike** — z-score on 5-minute cash_out buckets vs baseline:
- `z = (currentBucket − mean) / std`, flag when `z > 3 AND bucketCount ≥ 6`
- **Concentration classification before flagging:** top-3-account share ≥ 60% or amount CV < 0.15 → `velocity_spike` (requires review). Otherwise → `demand_surge` (info, `requiresReview: false`)

**Repeated near-identical amounts** — tolerance clustering in a 30-minute window:
- Merge neighbors within `max(৳100, 1.5% of amount)` — catches ৳9,800/9,900/10,000 splitting
- Flag cluster of ≥ 5 transactions from ≤ 3 distinct `customerHash`, spread ≤ `max(৳200, 2% of mean)`

Every anomaly finding includes `possibleNormalReasons` and `requiresReview: true`. Language is always "unusual / requires review" — enforced by `languageGuard.js`.

### 3. Data Quality & Safe Fallback (`services/dataQuality.js`)

| Subtype | Trigger | Effect |
|---------|---------|--------|
| `stale_feed` | No provider data for > 10 min | Confidence − 0.3; top-up withheld |
| `missing_feed` | Provider never sent a timestamp | Confidence − 0.4; top-up withheld |
| `balance_mismatch` | `\|opening + Σ delta − current\|` > ৳1 | Confidence − 0.2; top-up withheld |

Shared cash inherits the union of all provider issues (its flow mixes every provider's transactions).

### 4. Hybrid Decision (`services/ml/hybridDecision.js`)

Combines a trained tabular ML model (LightGBM or XGBoost, loaded as ONNX) with the rule engine output:

| Mode | Meaning |
|------|---------|
| `critical_override` | Hard safety rule triggers regardless of model |
| `model_rule_agreement` | Model above threshold AND rule triggered |
| `model_only` | Model above threshold; no rule triggered |
| `rule_only` | Rule triggered; model below threshold or unavailable |
| `none` | Neither triggered |

Two models are loaded at startup: `liquidity_shortage_60m` and `unusual_activity_review`. Output per provider: `riskScore` (0–1), `riskBand` (low/medium/high/critical), `confidenceScore`, `dataConfidence`, `decisionSource`, `fallbackReason`.

### 5. Explanation Layer (`services/explain.js`)

Structured evidence → natural language in English, Bengali, and Banglish.

- **Primary:** OpenAI `gpt-4o-mini` (4 s timeout, strict JSON mode)
- **Fallback:** Deterministic templates (fires when key absent, timeout, or any API error)
- **Guard:** Every generated field passes `assertSafeLanguage()` before save — banned words (fraud, fraudulent, criminal, guilty, accused, laundering, জালিয়াতি, অপরাধী …) reject the whole result and fall back to the safe template
- `explanationSource` field on each alert records which path produced it

### 6. Case Lifecycle (`services/caseWorkflow.js`)

```
new ──ack──▶ acknowledged ──assign──▶ in_progress ──resolve──▶ resolved
 │                │                        │
 └────────────escalate─────────────────────┴──▶ escalated ──resolve──▶ resolved
(dismiss allowed from new / acknowledged only — archived with audit entry)
```

Role gates enforced server-side:

| Role | Can do |
|------|--------|
| agent | acknowledge, note, dismiss (own outlet only) |
| field_officer | all of above + assign, escalate, resolve (own area) |
| ops | all of above (all areas, provider-scoped) |
| risk | resolve escalated cases |
| management | read-only — 403 on every mutation |

Escalation = authorized support request. It never moves money or contacts any external system.

---

## Case Coordination (Scenario D)

Every action appends to `history[]` with actor name, role, timestamp, and note — the immutable audit trail. Fields:

```
Alert.history[] = [{
  ts, actorUserId, actorName, actorRole, action, note
}]
Alert.evidenceHistory[] = [{           // capped at 20 snapshots
  ts, severity, confidence, evidence
}]
```

The `ownerName` field records a named human identity, not just a role — the audit trail shows who did what, not just which role acted.

---

## Tests & Validation

```bash
cd server

npm test                     # all unit tests (Node built-in test runner)
npm run validate             # 5 seeded in-memory metrics (no DB needed)
npm run validate -- --report # also writes validation-report.md to project root
npm run latency              # HTTP p50/p95/p99 against a running server
npm run test:coverage        # code coverage report (c8 → LCOV)
npm run sample-data          # regenerate portable dataset in data/sample/
```

### Unit tests

| File | What it covers | Tests |
|------|---------------|-------|
| `tests/scenarios.test.js` | All 4 demo scenarios end-to-end | 69 |
| `tests/anomaly.test.js` | Velocity spike, repeated amounts, demand_surge contrast | 7 |
| `tests/explain.test.js` | Template fallback, suppressed recommendations, trilingual fields | 4 |
| `tests/caseWorkflow.test.js` | State machine transitions, role gates, audit trail | 8 |
| `tests/dataQuality.test.js` | Stale/missing/mismatch detection, safe fallback | 6 |
| `tests/hybridDecision.test.js` | Critical override, model + rule modes | 2 |
| `tests/ruleEngine.test.js` | Rule definitions and triggers | — |
| `tests/signedDelta.test.js` | Cash/e-money flow direction correctness | — |
| `tests/languageGuard.test.js` | Banned-word detection | — |
| `tests/forecast.test.js` | Burn-rate arithmetic, zero-burn guard | — |
| `tests/simEngine.test.js` | Scenario transaction generators | — |
| `tests/featurePipeline.test.js` | Feature vector construction | — |
| `tests/evidenceMapper.test.js` | Evidence and freshness mapping | — |
| `tests/decisionSupport.test.js` | End-to-end pipeline integration | — |

### Validation metrics (seed 20260711)

Labels come from **behavioral scenarios** — what a simulated actor does — not from the detector's own thresholds. Scenario parameters use jittered non-round amounts and borderline counts so the evaluation can actually fail.

| # | Metric | Result | Target |
|---|--------|--------|--------|
| 1 | Anomaly precision | 93.8% (TP=56, FP=4) | ≥ 80% |
| 1 | Anomaly recall | 100% (TP=56, FN=0) | ≥ 80% |
| 2 | False-positive rate (20 normal scenarios × 3 types) | 6.7% | ≤ 10% |
| 3 | Shortage lead time — non-linear accelerating drain | median 79 min | ≥ 15 min |
| 4 | Alert explanation coverage (10 subtypes × 9 trilingual fields) | 100% | 100% |
| 5 | Engine latency — forecast + anomaly in-memory | p95 < 4 ms | p95 < 300 ms |

`npm run latency` measures end-to-end HTTP latency (p50/p95/p99) against a running server with MongoDB.

---

## ML Model Training

The ONNX model artifacts in `ml/artifacts/` are pre-built. To retrain:

```bash
# Generate training features from scenario tests
cd server
npm run ml:dataset           # writes data/ml/features.csv + data/ml/labels.csv

# Train with Python (Docker or local venv)
cd ml
python train.py \
  --features ../data/ml/features.csv \
  --labels   ../data/ml/labels.csv \
  --out      ./artifacts \
  --model-type lightgbm      # or xgboost

# Or use the Docker container (no local Python required)
docker build -t superagent-ml .
docker run --rm \
  -v "$(pwd)/../data/ml:/data" \
  -v "$(pwd)/artifacts:/out" \
  superagent-ml python train.py \
    --features /data/features.csv \
    --labels   /data/labels.csv \
    --out      /out
```

Training outputs an ONNX binary + manifest JSON to `ml/artifacts/`. The Node server loads them at startup via `modelRuntime.js` and falls back gracefully if the files are absent.

**Python dependencies** (`ml/requirements.txt`): `lightgbm==4.3`, `xgboost==2.0`, `scikit-learn==1.4`, `onnx==1.16`, `onnxmltools==1.12`, `skl2onnx==1.16`, `numpy==1.26`, `pandas==2.1`, `pytest==8`.

---

## CI/CD

GitHub Actions runs on every push to `main` and every PR sync (`.github/workflows/sonarcloud.yml`):

1. Install server and client dependencies
2. Run `npm run test:coverage` (Node built-in test runner + c8 LCOV report)
3. Build client (`npm run build`)
4. Upload coverage to SonarCloud for static analysis

**Required repository secrets:** `SONAR_TOKEN`.

---

## Data & Assumptions

### How the synthetic data was created

All data is entirely simulated. No real customers, balances, account numbers, or transactions are used anywhere.

**Seed generator (`server/scripts/lib/generateSeedData.js`)**

Uses a **deterministic mulberry32 PRNG** seeded at `20260711` (default). The same seed produces identical outlets, transaction history, and balances on every run. Change with `SEED=42 npm run seed`.

Three synthetic agent outlets:

| Agent ID | Name | Area | Thana |
|----------|------|------|-------|
| AGT-001 | Sylhet Super Agent Point | Amberkhana | Sylhet Sadar |
| AGT-002 | Zindabazar Telecom | Zindabazar | Sylhet Sadar |
| AGT-003 | Amberkhana Store | Amberkhana | Sylhet Sadar |

AGT-001 receives ~4 hours of baseline history (required for the z-score anomaly detector). AGT-002 and AGT-003 receive ~1 hour. Opening balances: cash ৳60,000–120,000; each provider e-money ৳40,000–90,000.

Transaction mix is **cash_out-leaning** (2 cash_out slots per 1 cash_in) to simulate pre-Eid demand. Amounts ৳500–6,000; ~3% are simulated `insufficient_funds` failures. Running balances satisfy `opening + Σ signedDelta === current` on clean seed data — no false `balance_mismatch` on unmodified data.

**Customer identifiers** are synthetic hashes (`CUST-XXXX`). No real identity, PIN, OTP, or account number exists anywhere.

**Simulation engine (`server/services/simEngine.js`)**

Runs a tick every 2 seconds. Each tick generates scenario-specific transactions, writes balances atomically to the agent document, then runs the full analytics pipeline and upserts alerts. NL text is generated once per alert creation or severity change — not on every poll.

### What each flag means

| Subtype | Signal | False-positive risk | Human review checks |
|---------|--------|--------------------|--------------------|
| `cash_depletion` | Shared cash projected below floor | Moderate — linear assumption fails on accelerating demand | Verify burn-rate window; check if a large `cash_in` is imminent |
| `emoney_depletion` | One provider's e-money projected below floor | Moderate | Verify provider flow trend; check for a planned B2B top-up |
| `velocity_spike` | Cash-out count > 3σ above baseline, concentrated | Low-medium — minimum-support guard (≥ 6 buckets) and concentration check reduce noise | Confirm account concentration; verify against known events; review `involvedTxnIds` |
| `repeated_amount` | ≥ 5 near-identical cash-outs from ≤ 3 accounts in 30 min | Low — tight spread + minimum count | Review listed `involvedTxnIds` with operations or risk staff |
| `demand_surge` | High volume, organically diverse | N/A — `requiresReview: false` | No review needed; monitor liquidity ETA |
| `stale_feed` | No provider data > 10 min | N/A | Contact provider operations to restore feed |
| `missing_feed` | Provider never sent a timestamp | N/A | Contact provider operations |
| `balance_mismatch` | Computed balance ≠ reported balance by > ৳1 | N/A — data problem, not behavior | Verify with provider before relying on this balance |
| `model_liquidity_risk` | ML model predicts elevated liquidity pressure | Medium — advisory only | Review balance, shared cash, approved support options |
| `model_unusual_review` | ML model flags unusual activity | Medium — advisory only | Review evidence with operations or risk staff |

**An anomaly score is not proof of wrongdoing.** Every signal requires human review before any real-world action.

### Stated assumptions

1. **Linear burn rate** — the forecast projects the 30-minute average forward. It underestimates during accelerating demand and overestimates during tapering. Confidence is reduced when CV > 0.5 or sample < 10.
2. **Minimum baseline** — the velocity spike detector returns no finding (safe fallback) when history has fewer than 6 buckets.
3. **Provider independence** — e-money balances are kept strictly separate. No cross-provider netting, conversion, or settlement is implied, computed, or displayed.
4. **Synthetic identifiers** — `customerHash` values have no connection to real identities.
5. **MFS cash-flow direction** — `cash_out` drains physical cash and increases provider e-money. `cash_in` increases cash and drains provider e-money. This is the standard Bangladesh MFS agent model.
6. **Single-agent live simulation** — the sim engine runs on one agent at a time. The validation harness runs fully in-memory.

### Limitations

- The forecast is a linear projection — no demand-spike modeling, time-of-day patterns, or Eid-rush acceleration.
- Two anomaly patterns are implemented (velocity spike and repeated amounts). Circular flows, location anomalies, failure-rate spikes, and transaction splitting are not covered.
- The ML model is trained on simulated data and does not generalise to real transaction distributions.
- Validation precision and recall are measured on scenario-labeled windows using parameters that deliberately differ from detector thresholds; results represent prototype behavior, not production-ready performance.
- AGT-002 and AGT-003 do not have enough baseline history to trigger the z-score detector in a live demo.

---

## Responsible Design & Guardrails (§14)

| Constraint | How it is enforced |
|------------|-------------------|
| Simulated data only | `simulated: true` on every DB record and every API response body |
| Providers logically separate | Separate `emoneyBalance` per provider; `visibilityScope()` scopes every query; `signedDelta` never cross-converts |
| No real wallet connections | Zero external financial API calls; sim engine writes to local MongoDB only |
| No customer credentials | `User.js` has no PIN/OTP/key field; `authController.js` comment: *"STAFF console authentication only"*; `Transaction.js` uses only `customerHash` |
| Advisory only, no fraud verdicts | `languageGuard.js` bans 22 terms (fraud, criminal, guilty, accused, laundering, Bengali equivalents); `requiresReview: true` on every anomaly; `possibleNormalReasons` displayed |
| No auto-block or financial action | No endpoint or service writes to an external system; `dismiss` archives the alert without touching balances; escalation writes a history entry only |
| Coordination never transfers liquidity | `ESCALATION_TARGETS = ['ops', 'risk']`; assignment validates role + area + providerScope server-side; every mutation goes through `validateAction()` + `hasCaseAuthority()` |
| Assumptions documented | This README — Data & Assumptions section; `validate.js` methodology; 69 scenario tests |

---

## File Reference

### Server

| Path | Purpose |
|------|---------|
| `server/server.js` | Express app entry point |
| `server/config/db.js` | MongoDB connection with fail-fast on Atlas DNS |
| `server/config/decisionConfig.js` | ML thresholds, risk bands, staleness window (reads env vars) |
| `server/middleware/auth.js` | JWT verify — attaches role, area, providerScope to req.user |
| `server/models/Agent.js` | Agent outlet schema (1 cash drawer + per-provider e-money) |
| `server/models/Alert.js` | Alert schema with case lifecycle, history[], evidenceHistory[] |
| `server/models/Transaction.js` | Transaction schema with signed balance snapshots |
| `server/models/User.js` | Staff user schema (no customer credentials) |
| `server/models/Prediction.js` | ML prediction audit log |
| `server/controllers/alertController.js` | Case lifecycle — visibilityScope() on every read + write |
| `server/controllers/authController.js` | Staff login + in-memory throttle |
| `server/controllers/agentController.js` | Agent reads + stale-provider annotation |
| `server/controllers/decisionController.js` | GET /agents/:id/decision-support |
| `server/controllers/simController.js` | Sim control with role-scoped access |
| `server/controllers/modelController.js` | GET /model/status |
| `server/services/simEngine.js` | Compute-on-write sim tick (scenarios A/B/C/D) |
| `server/services/forecast.js` | Burn-rate liquidity forecast (per resource) |
| `server/services/anomaly.js` | Velocity spike + repeated-amount detectors |
| `server/services/dataQuality.js` | Stale/missing feed + balance mismatch detection |
| `server/services/explain.js` | OpenAI + template trilingual explanation layer |
| `server/services/languageGuard.js` | Careful-language runtime guard (22 banned terms) |
| `server/services/caseWorkflow.js` | State machine, role gates, authority checks |
| `server/services/signedDelta.js` | Canonical cash/e-money flow direction per txn type |
| `server/services/ml/decisionSupport.js` | Full analytics pipeline per provider |
| `server/services/ml/hybridDecision.js` | Model + rules combiner → riskScore, riskBand, mode |
| `server/services/ml/featurePipeline.js` | Feature vector builder with schema versioning |
| `server/services/ml/modelRuntime.js` | ONNX model loader + predict (graceful fallback) |
| `server/services/ml/evidenceMapper.js` | Readable evidence + data-freshness map |
| `server/services/rules/ruleEngine.js` | Rule evaluation harness |
| `server/services/rules/ruleDefinitions.js` | Hard-safety and anomaly rule definitions |
| `server/scripts/lib/generateSeedData.js` | Deterministic synthetic data generator (mulberry32 PRNG) |
| `server/scripts/seed.js` | Database seeder |
| `server/scripts/validate.js` | In-memory validation harness — 5 measured metrics |
| `server/scripts/latency-http.js` | End-to-end HTTP latency (p50/p95/p99) |

### Client

| Path | Purpose |
|------|---------|
| `client/src/pages/Dashboard.jsx` | Role-scoped dashboard with provider/kind/status/riskBand filters |
| `client/src/pages/AgentDetail.jsx` | Unified balance + forecast + sim controls + alert feed |
| `client/src/pages/CaseView.jsx` | Case lifecycle UI with action buttons and audit timeline |
| `client/src/pages/Login.jsx` | Staff login form |
| `client/src/components/BalanceHero.jsx` | One cash drawer + three separate provider bars |
| `client/src/components/ForecastPanel.jsx` | Per-resource depletion ETA + confidence meter |
| `client/src/components/AlertsFeed.jsx` | Alert list with severity, kind, and quick-dismiss |
| `client/src/components/AlertExplanation.jsx` | Expandable evidence rows + decision mode + language toggle |
| `client/src/components/CaseTimeline.jsx` | Audit history timeline |
| `client/src/components/ConfidenceMeter.jsx` | 0–1 visual confidence indicator |
| `client/src/components/RiskConfidence.jsx` | Risk score + confidence band display |
| `client/src/components/DecisionSummary.jsx` | Decision mode, triggered rules, safe next step |
| `client/src/components/ModelStatus.jsx` | ML model availability banner |
| `client/src/components/LiveStatus.jsx` | Last-updated timestamp + error indicator |
| `client/src/api/client.js` | Typed API client (all endpoints) |
| `client/src/hooks/usePolling.js` | Polling hook with error state |
| `client/src/context/AuthContext.jsx` | JWT auth context |
| `client/src/i18n/en.js` | English string table |
| `client/src/i18n/bn.js` | Bengali string table |
| `client/src/i18n/banglish.js` | Banglish string table |

### ML

| Path | Purpose |
|------|---------|
| `ml/train.py` | LightGBM/XGBoost training → ONNX export |
| `ml/Dockerfile` | Python 3.11-slim container for reproducible training |
| `ml/requirements.txt` | Python dependencies |
| `ml/artifacts/` | Pre-built ONNX model + manifest (loaded at server startup) |
| `data/ml/` | Generated feature/label CSVs for training |
| `data/sample/` | Portable synthetic transaction dataset |

---

## Out of Scope

- Real interoperability, settlement, or conversion between bKash, Nagad, and Rocket
- Production APIs, real customer identities, real balances or accounts
- Auto-block, accusation, disciplinary action, or final fraud determination
- Unauthorized cash movement, wallet refill, transfer, recovery, or reversal
- Collection of customer PINs, OTPs, passwords, or private keys
- Claims of regulatory approval or production fraud-detection readiness
- Native Android app (web only)

---

## Original Plan

Full spec, acceptance criteria, and engineering decisions: [`SPEC.md`](SPEC.md)
