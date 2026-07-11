# Super-Agent Liquidity & Risk Console

Decision-support prototype for multi-provider mobile-financial-service (MFS) agents — built for **bKash presents SUST CSE Carnival 2026** (Codex Community Hackathon).

> ⚠ **SIMULATED DATA ONLY.** This prototype never connects to real wallets, never moves money, never collects customer credentials, and never makes fraud determinations. All risk signals are advisory and require human review.

## What it does

A "super agent" outlet serves bKash, Nagad, and Rocket customers from **one physical cash drawer** but **three separate e-money balances**. This console:

1. **Unifies the view** — shared cash + per-provider e-money on one screen (providers stay logically separate; never merged or converted — and the separation is *enforced* server-side on every endpoint, not just displayed).
2. **Forecasts shortages** — burn-rate projection per resource: *which* provider or the cash drawer will run short, *when*, with *what confidence*, and a **quantified top-up suggestion**.
3. **Flags unusual activity with evidence** — velocity z-score with **concentration classification** (a diverse Eid rush is labeled `demand_surge` context, not flagged for review) + repeated near-identical amounts via tolerance clustering. Careful language only ("unusual", "requires review") — enforced by a runtime guard.
4. **Coordinates the response** — alerts route to a role, get acknowledged, **assigned to a named owner**, escalated (authorized support request), and resolved — through a validated state machine (a resolved case can't be re-acknowledged; management is read-only), with a full audit timeline recording actor identity and evidence snapshots.
5. **Fails safe** — stale, missing, or conflicting provider feeds lower confidence, show a banner, and **withhold the top-up recommendation** for the affected provider and shared cash. A transaction the outlet can't cover fails (`insufficient_funds`) instead of corrupting balances. Bad data lowers claims; it never produces confident output.

## Quick start

Prereqs: Node ≥ 18, MongoDB (local `mongod` or an Atlas URI).

```bash
# 1. Server
cd server
npm install
cp ../.env.example .env        # edit MONGO_URI if not local; JWT_SECRET is required
npm run seed                   # deterministic synthetic data (SEED env var, default 20260711)
npm start                      # API on :5000

# 2. Client (new terminal)
cd client
npm install
npm run dev                    # UI on :5173 (proxies /api to :5000)
```

Log in (password `demo1234` for all):

| Account | Role | Sees / may do |
|---|---|---|
| `agent@demo.test` | agent | own outlet (AGT-001) only — other outlets 404 |
| `field@demo.test` | field officer | agents in Amberkhana; receives liquidity alerts |
| `ops@demo.test` | provider ops | all areas; receives anomaly + data-quality alerts |
| `risk@demo.test` | risk analyst | escalated cases |
| `mgmt@demo.test` | management | **read-only** — every mutation route rejects it |

## Demo flow (the Eid story)

1. Log in as `field@demo.test`, open **AGT-001**.
2. Pick a scenario and press **Eid rush** (or step tick-by-tick):
   - **A** — hidden shortage: totals look fine, Nagad e-money is dying. Watch the forecast panel.
   - **B** — repeated ৳9,800 cash-outs from 3 accounts flag on bKash **while a bigger organic Rocket burst classifies as info-level `demand_surge`, never a review flag** (false-positive contrast).
   - **C** — Rocket's feed goes stale **on the first tick** and its balance stops reconciling by tick 5: confidence drops, banner shows, and top-up recommendations are withheld for Rocket *and* shared cash.
   - **D** — critical volume: open the case → acknowledge → assign an owner → escalate to risk → resolve. Try acknowledging again: the state machine refuses (409). The timeline records every actor by name.
3. Toggle **EN / বাংলা / Banglish** — every alert (title, message, next step) is fully trilingual; the choice survives reloads.
4. Filter the dashboard by provider, alert type, or status.

## Tests & validation

```bash
cd server
npm test                # 50 unit tests: engines, safe fallback, money integrity,
                        # case state machine, language guard, Scenario B contrast
npm run validate        # 5 seeded, reproducible metrics (in-memory, no DB needed)
npm run validate:report # also writes docs/validation-report.md
npm run latency         # end-to-end HTTP p50/p95/p99 against the running server
npm run sample-data     # regenerates the portable dataset in data/sample/
```

Latest seeded run (seed 20260711 — full report with methodology in
[`docs/validation-report.md`](docs/validation-report.md)): anomaly precision
93.8%, recall 100%, false-positive rate 6.7% on scenario-labeled normal windows
(dominant FP source documented), median shortage lead time 79 min on a
deliberately non-linear drain, explanation coverage 100% (10/10 subtypes × 9
trilingual fields), HTTP forecast p95 3.6 ms (local MongoDB; a remote Atlas
cluster adds network RTT — see the validation report).

Validation labels come from behavioral scenarios, **not** the detector's own
thresholds — see the report for why that matters.

## Architecture (MVC)

```
client/  (View — React)                server/  (Model–Controller)
  pages/ components/ i18n/               models/       Mongoose schemas
  api/client.js  ← polls every 3s        controllers/  scope-enforced handlers
                                         services/     forecast · anomaly ·
        reads only ──────▶ REST API                    dataQuality · caseWorkflow ·
                                                       explain · languageGuard · simEngine
                                         routes/       wiring + role gates
  Compute-on-WRITE: the sim tick generates alerts + NL text ONCE; the client poll
  only reads (the forecast read re-runs cheap pure functions — no alert writes,
  no OpenAI in the request path). OpenAI (optional) is guard-checked; template
  fallback keeps the demo alive with no API key.
```

Full diagrams: [`docs/architecture.md`](docs/architecture.md) (+ [`diagrams/`](diagrams/)) · Data & validation assumptions: [`docs/data-simulation.md`](docs/data-simulation.md) · Safety boundaries: [`docs/responsible-design.md`](docs/responsible-design.md) · Measured evidence: [`docs/validation-report.md`](docs/validation-report.md) · Presentation: [`docs/presentation.md`](docs/presentation.md) · Sample dataset: [`data/sample/`](data/sample/) · Original plan: [`SPEC.md`](SPEC.md)

## OpenAI (optional)

Set `OPENAI_API_KEY` in `server/.env` to generate alert prose via GPT-4o-mini (4s timeout, strict-JSON, output passes the careful-language runtime guard or is rejected). Without a key — or on any failure — deterministic trilingual templates take over. `explanationSource` on each alert shows which path produced it.
