# Super-Agent Liquidity & Risk Console

Decision-support prototype for multi-provider mobile-financial-service (MFS) agents — built for **bKash presents SUST CSE Carnival 2026** (Codex Community Hackathon).

> ⚠ **SIMULATED DATA ONLY.** This prototype never connects to real wallets, never moves money, never collects customer credentials, and never makes fraud determinations. All risk signals are advisory and require human review.

## What it does

A "super agent" outlet serves bKash, Nagad, and Rocket customers from **one physical cash drawer** but **three separate e-money balances**. This console:

1. **Unifies the view** — shared cash + per-provider e-money on one screen (providers stay logically separate; never merged or converted).
2. **Forecasts shortages** — burn-rate projection per resource: *which* provider or the cash drawer will run short, *when*, with *what confidence*, and a **quantified top-up suggestion**.
3. **Flags unusual activity with evidence** — velocity z-score + repeated near-identical amounts from few accounts. Careful language only ("unusual", "requires review") — enforced by a runtime guard.
4. **Coordinates the response** — alerts route to a role, get acknowledged, escalated (authorized support request), and resolved, with a full audit timeline.
5. **Fails safe** — stale or conflicting provider feeds lower confidence, show a banner, and suppress recommendations instead of guessing.

## Quick start

Prereqs: Node ≥ 18, MongoDB (local `mongod` or an Atlas URI).

```bash
# 1. Server
cd server
npm install
cp ../.env.example .env        # edit MONGO_URI if not local
npm run seed                   # synthetic agents, users, baseline history
npm start                      # API on :5000

# 2. Client (new terminal)
cd client
npm install
npm run dev                    # UI on :5173 (proxies /api to :5000)
```

Log in (password `demo1234` for all):

| Account | Role | Sees |
|---|---|---|
| `agent@demo.test` | agent | own outlet (AGT-001) |
| `field@demo.test` | field officer | agents in Amberkhana; receives liquidity alerts |
| `ops@demo.test` | provider ops | all areas; receives anomaly + data-quality alerts |
| `risk@demo.test` | risk analyst | escalated cases |
| `mgmt@demo.test` | management | read-only |

## Demo flow (the Eid story)

1. Log in as `field@demo.test`, open **AGT-001**.
2. Pick a scenario and press **🌙 Eid rush**:
   - **A** — hidden shortage: totals look fine, Nagad e-money is dying. Watch the forecast panel.
   - **B** — repeated ৳9,800 cash-outs from 3 accounts flag on bKash **while a bigger but normal Rocket burst stays green** (false-positive contrast).
   - **C** — Rocket feed goes stale + balance stops reconciling: confidence drops, banner shows, no recommendation from bad data.
   - **D** — critical volume: open the case → acknowledge → escalate to risk → resolve. The timeline records every step.
3. Toggle **EN / বাংলা / Banglish** — every alert is trilingual.

## Tests & validation

```bash
cd server
npm test          # 15 unit tests: engines, language guard, fallback, zero-burn guard
npm run validate  # 5 measured metrics (in-memory, no DB needed)
```

Latest validation run: anomaly precision 100%, recall 100%, FP rate 0% on normal Eid bursts, median shortage lead time 75 min, explanation coverage 100% (6/6 subtypes), engine latency p95 < 0.1 ms.

## Architecture (MVC)

```
client/  (View — React)                server/  (Model–Controller)
  pages/ components/ i18n/               models/       Mongoose schemas
  api/client.js  ← polls every 3s        controllers/  thin handlers
                                         services/     forecast · anomaly ·
        reads only ──────▶ REST API                    dataQuality · explain ·
                                                       languageGuard · simEngine
                                         routes/       wiring only
  Compute-on-WRITE: the sim tick recomputes analytics + generates alert text ONCE;
  the client poll only reads. OpenAI (optional) is guard-checked; template fallback
  keeps the demo alive with no API key.
```

Full diagrams: [`docs/architecture.md`](docs/architecture.md) · Data assumptions: [`docs/data-simulation.md`](docs/data-simulation.md) · Safety boundaries: [`docs/responsible-design.md`](docs/responsible-design.md) · Original plan: [`SPEC.md`](SPEC.md)

## OpenAI (optional)

Set `OPENAI_API_KEY` in `server/.env` to generate alert prose via GPT-4o-mini (4s timeout, strict-JSON, output passes the careful-language runtime guard or is rejected). Without a key — or on any failure — deterministic trilingual templates take over. `explanationSource` on each alert shows which path produced it.
