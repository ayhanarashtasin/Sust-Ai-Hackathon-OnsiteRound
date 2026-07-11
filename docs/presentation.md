# Final Presentation — Super-Agent Liquidity & Risk Console

*Slide-by-slide deck with speaker notes and a timed live-demo script.
Target: 8–10 minutes + Q&A. Every number on these slides is reproducible
(`npm run validate -- --seed 20260711`; see docs/validation-report.md).*

---

## Slide 1 — Title

**Super-Agent Liquidity & Risk Console**
Decision support for multi-provider MFS agents — bKash · Nagad · Rocket

> ⚠ Simulated data only · advisory signals only · humans decide

*Speaker note:* One sentence: "We help a shop that serves three mobile-money
providers from one cash drawer answer a question none of its three apps can:
**will I still be able to serve customers at 5 pm?**"

---

## Slide 2 — The problem (the Eid afternoon)

- One physical cash drawer. Three separate e-money balances.
- Each provider app shows its own slice — **nobody shows the whole outlet.**
- The dangerous case: **totals look healthy while one provider is dying.**
- When something odd happens, four people (agent, field officer, ops, risk)
  don't know who acts first — or whether anyone did.

*Speaker note:* Anchor on Scenario A: the sum says ৳1.9 lakh, but Nagad e-money
runs out in 40 minutes — every Nagad cash-in from now on is a turned-away customer.

---

## Slide 3 — Users & boundaries

| Who | Gets | Boundary (enforced server-side) |
|---|---|---|
| Agent | own outlet's unified view + forecasts | other outlets → 404 |
| Field officer | liquidity alerts for their area | other areas → 404 |
| Provider ops | anomaly + data-quality alerts, all areas | cannot decide fraud — escalates |
| Risk analyst | escalated cases with evidence | final review, human decision |
| Management | read-only overview | every mutation → 403 |

*Speaker note:* Emphasize: provider separation is not a UI label — it's enforced
on every endpoint, and we demo that live (direct-URL access attempt).

---

## Slide 4 — What we built (one product, not three charts)

```
anomaly burst ──▶ burn rate ↑ ──▶ depletion ETA ↓ ──▶ quantified top-up advice
      │                                                    │
      └── evidence + careful language ──▶ routed case ──▶ ack → assign → escalate → resolve
```

- **Forecast:** per-resource burn rate → ETA → confidence → suggested top-up
- **Anomaly:** velocity z-score + concentration classification · repeated-amount tolerance clustering
- **Data quality:** stale / missing / conflicting feeds → confidence dimmed **and recommendation withheld**
- **Coordination:** state-machine case lifecycle with named owners and a full audit trail

---

## Slide 5 — Live demo (script below)

*(switch to the app — timings assume the step-by-step tick button)*

1. **[Scenario A — 60s]** Balance hero: totals healthy, Nagad bar shrinking.
   Forecast row goes amber: "Nagad may deplete around HH:MM (≈40 min) · +৳XX,000
   suggested." Toggle বাংলা — the alert reads in Bangla, quantified.
2. **[Scenario B — 90s]** Two bursts hit at once. bKash: repeated ৳9,800s from 3
   accounts → **requires review** with z-score, account count, txn IDs. Rocket:
   *bigger* burst, but diverse → info-level **demand_surge**: "consistent with a
   normal rush — no review needed." That's our false-positive story in one screen.
3. **[Scenario C — 60s]** First tick: Rocket feed goes stale. Banner appears,
   Rocket confidence drops, and its top-up recommendation **disappears** —
   so does the shared-cash recommendation (its flow mixes all feeds). Tick 5:
   balance stops reconciling → second data-quality alert. No confident advice
   from broken data.
4. **[Scenario D — 90s]** Critical case → open it: routed to ops, unowned.
   Acknowledge (owner: Karim, by name) → assign to Risk Analyst (dropdown of
   real users — arbitrary IDs are rejected) → escalate (authorized support
   request) → resolve. Try to acknowledge again → **409, illegal transition**.
   Timeline shows who did what, when; evidence history preserved as snapshots.

---

## Slide 6 — Architecture

*(use diagrams/super-agent-console-architecture.png)*

- React client, read-only 3s poll with visible last-updated / connection-lost state
- Express API: JWT + role gates + scope filters on **every** route; async errors
  fail the request, never the server
- Service layer: forecast · anomaly · dataQuality · caseWorkflow (pure state
  machine) · explain (OpenAI 4s-timeout → language guard → template fallback)
- MongoDB: agents (shared cash + per-provider balances + feed timestamps),
  transactions, alerts with audit history
- Compute-on-write: alerts + NL text generated once per tick, never per poll

---

## Slide 7 — Measured evidence (seeded & reproducible)

| Metric | Result | How it's honest |
|---|---|---|
| Anomaly precision / recall | **93.8% / 100%** | labels from behavioral scenarios, *not* detector rules |
| False-positive rate | **6.7%** | dominant source identified: uniform salary-day windows |
| Shortage lead time | **median 79 min** (worst 52) | measured on a *non-linear* drain that violates the model's assumption |
| Explanation coverage | **100%** (8 subtypes × 9 trilingual fields) | every field passes the careful-language guard |
| HTTP latency | forecast **p95 3.6 ms**, 10-way concurrent p95 19 ms | full stack, seeded DB, documented volume |

Plus: 40 unit tests, 33-assertion scripted end-to-end check (scoping, state
machine, fallback, dismiss-as-archive), `npm run validate` reruns everything.

---

## Slide 8 — Safety & responsible design

- Careful language **enforced at runtime** — a banned-word guard filters every
  message, including LLM output; "unusual / requires review," never an accusation
- A demand spike with diverse accounts/amounts is **explained, not accused**
  (demand_surge classification)
- Bad data ⇒ lower confidence **and no recommendation** — never confident output
- No transfers, freezes, blocks, or fraud verdicts exist in the codebase
- Dismiss archives with history — the audit record is never deleted
- Synthetic identifiers everywhere; staff-only auth; no PIN/OTP fields anywhere

---

## Slide 9 — Limitations (stated, not hidden)

- Synthetic data approximates reality; real FP rates would be higher — the
  human-review workflow is the containment, and reviewer feedback loops are the
  obvious next iteration
- Balance writes are not multi-document-atomic (needs a replica set) — failures
  surface as reconciliation alerts instead (fail-loud, documented)
- One global sim (single demo at a time); JWT in localStorage — demo-scope
  trade-offs listed in docs/responsible-design.md
- No cross-agent network/hotspot views yet — the data model supports them

---

## Slide 10 — What's next & close

- Reviewer feedback → adaptive thresholds (the review outcome trains the flag)
- Area/hotspot map + nearby-agent support discovery
- Per-provider ops tenancy (providerScope claim is already in the JWT)
- Native Bangla voice alerts for low-literacy agents

**Close:** "Three providers, one drawer, one afternoon of Eid rush — and one
screen that tells everyone the same true story, with the evidence to check it
and a named human on the hook to act. Thank you."

---

## Appendix — demo recovery playbook

- Anything looks stuck → **🧹 Reset demo** (restores the seeded baseline deterministically)
- No OpenAI key / API down → alerts still generate (template path; `explanationSource: template`)
- MongoDB down → server health endpoint reports it (503) and requests fail loudly, not silently
- Judge asks "can the agent see other outlets?" → log in as `agent@demo.test`, hit
  `/agent/AGT-002` by URL → 404 (same for the API directly)
