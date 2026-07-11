# Architecture

## System overview

```
┌──────────────────────── View (client/, React + Vite) ────────────────────────┐
│  Login · Dashboard (filters: provider/type/status) · AgentDetail             │
│  (balance hero, forecast + suppression, alerts, Eid rush, live status)       │
│  CaseView (evidence + snapshots, assign/ack/escalate/resolve, audit          │
│  timeline with actor identity) · i18n EN/বাংলা/Banglish (persisted)           │
│  api/client.js — the ONLY fetch path · usePolling (3s, read-only,            │
│  lastUpdated + visible connection-lost state)                                │
└──────────────────────────────────┬───────────────────────────────────────────┘
                                   │ REST /api (JWT bearer, CORS-restricted)
┌──────────────────────────────────▼───────────────────────────────────────────┐
│                        Controller layer (server/)                            │
│  routes/ (wiring + role gates) → middleware/auth (JWT verify · asyncH)       │
│  controllers/ auth (login throttle) · agent (scope-enforced reads)           │
│  · alert (workflow-validated lifecycle) · sim (scope-checked control)        │
│  request-id JSON logging · central error handler (no internals leak)         │
└──────────────────────────────────┬───────────────────────────────────────────┘
┌──────────────────────────────────▼───────────────────────────────────────────┐
│                     Service layer (business logic)                            │
│  simEngine  ── tick every 2s (COMPUTE-ON-WRITE, overlap-guarded) ─────┐      │
│    1 scenario txns → 2 applyTxns (insufficient funds ⇒ txn FAILS,     │      │
│      never clamps) → 3 recompute: dataQuality → forecast → anomaly    │      │
│    4 upsert alerts (dedup while open · evidence snapshots ·           │      │
│      re-alert cooldown after close) + explain (once per alert)        │      │
│  dataQuality  stale/missing feed · balance reconciliation → ISSUE MAP │      │
│  forecast     burn rate → ETA → confidence; any data issue DIMS       │      │
│               confidence AND WITHHOLDS the top-up recommendation      │      │
│  anomaly      velocity z-score + concentration classification         │      │
│               (concentrated ⇒ review flag · diverse ⇒ demand_surge    │      │
│               info) · repeated-amount tolerance clustering            │      │
│  caseWorkflow legal-transition state machine + role/target validation │      │
│  explain      OpenAI (4s timeout) ─▶ languageGuard ─▶ or template     │      │
│  languageGuard  banned-word runtime check on EVERY message (AC-4)     │      │
└──────────────────────────────────┬────────────────────────────────────┘      │
┌──────────────────────────────────▼───────────────────────────────────────────┐
│                     Model layer (MongoDB / Mongoose)                          │
│  users · agents (shared cash + per-provider e-money, lastFeedAt)              │
│  transactions (indexed {agentId, provider, timestamp}, failureReason)         │
│  alerts (evidence + evidenceHistory snapshots, trilingual text,               │
│          history[] audit trail with actor identity)                           │
└───────────────────────────────────────────────────────────────────────────────┘
```

## Read path vs write path (honest version)

- **Write path (sim tick):** scenario transactions are applied, alerts are
  upserted, and natural-language text is generated **once** per alert
  creation/severity change. No OpenAI call or alert write ever happens because a
  client polled.
- **Read path (3s poll):** `GET /forecast` re-runs the *pure* forecast functions
  (measured p95 < 0.1 ms in-memory; ~3 ms over HTTP) against current data. This is
  deliberate: staleness depends on wall-clock feed age, so a read must reflect a
  feed that aged past its threshold *between* ticks.
- **Balance writes are NOT multi-document-atomic.** All balances live in one
  agent document (that save is atomic); the transaction insert is a separate
  write. A crash between the two surfaces as a `balance_mismatch` data-quality
  alert (fail-loud) rather than silent corruption. Real multi-document
  transactions require a replica set and are out of demo scope — documented, not
  claimed.

## Provider and role boundaries (enforced, not just displayed)

Each provider (bKash / Nagad / Rocket) is a logically separate balance with its own
feed timestamp, floor threshold, forecast, and data-quality state. Nothing in the
system converts, settles, or transfers between providers. Escalation raises an
*authorized support request* — a workflow object, never a financial action.

Enforcement happens server-side on **every** endpoint, including direct-by-id access:

| Role | Sees / may act on |
|---|---|
| agent | own outlet only (other outlets: 404) |
| field_officer | outlets and alerts in own area |
| ops | all areas |
| risk | escalated / resolved cases |
| management | read-only everywhere — every mutation route rejects it (403) |

## Case lifecycle state machine

```
 new ──ack──▶ acknowledged ──assign──▶ in_progress ──resolve──▶ resolved
  │                │                        │
  └────────────escalate─────────────────────┴──▶ escalated ──resolve──▶ resolved
 (dismiss = ARCHIVE, allowed from new/acknowledged only; nothing is deleted)
```

Every action is validated (`services/caseWorkflow.js`) before any write: illegal
transitions → 409, unauthorized roles → 403, arbitrary assignees/escalation
targets → 400. Every transition appends an audit entry with actor **identity**
and role; evidence updates snapshot the previous evidence instead of overwriting.

## The causal chain (why this is one product, not three charts)

```
anomaly burst (repeated cash-outs)
      │ inflates cash outflow
      ▼
burn rate ↑ ──▶ time-to-depletion ↓ ──▶ liquidity alert (quantified top-up)
      │                                       │
      └── anomaly alert (evidence) ───────────┤ both route to roles
                                              ▼
                             case: ack → assign → escalate → resolve (audit trail)
```

## Alert routing

| Alert kind | Subtypes | Routed to | Escalates to |
|---|---|---|---|
| liquidity | cash/emoney_depletion · demand_surge (info) | field_officer | ops / risk |
| anomaly | velocity_spike · repeated_amount | ops | ops / risk |
| data_quality | stale_feed · missing_feed · balance_mismatch | ops | ops / risk |

## Failure modes engineered for

| Failure | Behavior |
|---|---|
| OpenAI down / no key / timeout | template fallback, `explanationSource: template` |
| LLM emits banned word | languageGuard rejects → template |
| Provider feed stale (>10 min) or **never received** | confidence dimmed, banner, **top-up recommendation withheld** for that provider AND shared cash |
| Balance doesn't reconcile | data_quality alert + confidence dimmed + recommendation withheld; "data problem", not a behavior conclusion |
| Transaction the outlet cannot cover | txn recorded as `failed (insufficient_funds)`, balances untouched — no negative or fabricated value |
| Zero burn rate | "stable" — no divide-by-zero, no false alarm |
| Sparse anomaly history | no flag (safe fallback) — never guess from thin data |
| Legitimate demand spike (diverse accounts/amounts) | classified `demand_surge` (info, no review) — context, not a false accusation |
| Case just resolved/dismissed, condition persists | 10-min re-alert cooldown — a human's decision isn't instantly overridden |
| DB error inside a request | `asyncH` routes it to the central handler — the request fails, the server survives, internals never reach the client |
| Slow tick | overlap guard skips the next tick instead of racing balances |
| Repeated failed logins | per-email+IP throttle (10 / 15 min → 429) |
| API unreachable from the UI | visible "connection lost — retrying" state + last-updated timestamp |
```
