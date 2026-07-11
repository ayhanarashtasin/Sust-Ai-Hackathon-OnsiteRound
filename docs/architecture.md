# Architecture

## System overview

```
┌──────────────────────── View (client/, React + Vite) ────────────────────────┐
│  Login · Dashboard · AgentDetail (balance hero, forecast, alerts, Eid rush)  │
│  CaseView (evidence, actions, audit timeline) · i18n EN/বাংলা/Banglish        │
│  api/client.js — the ONLY fetch path · usePolling (3s, read-only)            │
└──────────────────────────────────┬───────────────────────────────────────────┘
                                   │ REST /api (JWT bearer)
┌──────────────────────────────────▼───────────────────────────────────────────┐
│                        Controller layer (server/)                            │
│  routes/ (wiring only) → middleware/auth (JWT verify + role)                 │
│  controllers/ auth · agent (role-scoped reads) · alert (lifecycle) · sim     │
└──────────────────────────────────┬───────────────────────────────────────────┘
┌──────────────────────────────────▼───────────────────────────────────────────┐
│                     Service layer (business logic)                            │
│  simEngine  ──── tick every 2s (COMPUTE-ON-WRITE) ────────────────────┐      │
│    1 scenario txns → 2 applyTxns (SINGLE atomic balance writer)       │      │
│    3 recompute: forecast + anomaly + dataQuality                      │      │
│    4 upsert alerts (dedup while open) + explain (once per alert)      │      │
│  forecast    burn rate → depletion ETA → confidence → suggestedTopUp  │      │
│  anomaly     velocity z-score · repeated-amount clustering            │      │
│  dataQuality stale feed · balance reconciliation                      │      │
│  explain     OpenAI (4s timeout) ─▶ languageGuard ─▶ or template      │      │
│  languageGuard  banned-word runtime check on EVERY message (AC-4)     │      │
└──────────────────────────────────┬────────────────────────────────────┘      │
┌──────────────────────────────────▼───────────────────────────────────────────┐
│                     Model layer (MongoDB / Mongoose)                          │
│  users · agents (shared cash + per-provider e-money, lastFeedAt)              │
│  transactions (indexed {agentId, provider, timestamp})                        │
│  alerts (evidence, trilingual text, history[] audit trail)                    │
└───────────────────────────────────────────────────────────────────────────────┘
```

## Provider boundaries

Each provider (bKash / Nagad / Rocket) is a logically separate balance with its own
feed timestamp, floor threshold, and forecasts. The UI shows a combined total labeled
"view only". Nothing in the system converts, settles, or transfers between providers.
Escalation raises an *authorized support request* — a workflow object, never a
financial action.

## The causal chain (why this is one product, not three charts)

```
anomaly burst (repeated cash-outs)
      │ inflates cash outflow
      ▼
burn rate ↑ ──▶ time-to-depletion ↓ ──▶ liquidity alert (quantified top-up)
      │                                       │
      └── anomaly alert (evidence) ───────────┤ both route to roles
                                              ▼
                             case: ack → escalate → resolve (audit trail)
```

## Alert routing

| Alert kind | Routed to | Escalates to |
|---|---|---|
| liquidity | field_officer | risk |
| anomaly | ops | risk |
| data_quality | ops | risk |

## Failure modes engineered for

| Failure | Behavior |
|---|---|
| OpenAI down / no key / timeout | template fallback, `explanationSource: template` |
| LLM emits banned word | languageGuard rejects → template |
| Provider feed stale (>10 min) | confidence dimmed, banner, no recommendation from that feed |
| Balance doesn't reconcile | data_quality alert; "data problem", not a behavior conclusion |
| Zero burn rate | "stable" — no divide-by-zero, no false alarm |
| Sparse anomaly history | no flag (safe fallback) — never guess from thin data |
