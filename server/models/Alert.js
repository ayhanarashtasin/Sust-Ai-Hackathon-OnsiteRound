import mongoose from 'mongoose';

/*
  Alert lifecycle (Scenario D — coordinated response):

    new ──ack──▶ acknowledged ──▶ in_progress ──resolve──▶ resolved
     │                │                │
     └───────────escalate──────────────┘──▶ escalated (risk) ──resolve──▶ resolved
    (dismiss allowed from new/acknowledged — recorded in history)

  Every transition appends to history[] — the audit trail judges see.
*/
const historySchema = new mongoose.Schema(
  {
    ts: { type: Date, default: Date.now },
    actorUserId: { type: String, default: null },
    actorRole: { type: String, default: 'system' },
    action: { type: String, required: true },
    note: { type: String, default: '' },
  },
  { _id: false }
);

const alertSchema = new mongoose.Schema(
  {
    alertId: { type: String, required: true, unique: true },
    agentId: { type: String, required: true },
    area: { type: String, required: true },
    kind: { type: String, enum: ['liquidity', 'anomaly', 'data_quality'], required: true },
    provider: { type: String, enum: ['bKash', 'Nagad', 'Rocket', null], default: null }, // null = shared cash
    subtype: {
      type: String,
      enum: [
        'cash_depletion',
        'emoney_depletion',
        'velocity_spike',
        'repeated_amount',
        'stale_feed',
        'balance_mismatch',
      ],
      required: true,
    },
    severity: { type: String, enum: ['info', 'warning', 'critical'], required: true },
    confidence: { type: Number, min: 0, max: 1, required: true },
    title_en: String,
    title_bn: String,
    message_en: String,
    message_bn: String,
    message_banglish: String,
    recommendedNextStep_en: String, // includes computed suggestedTopUp amount
    recommendedNextStep_bn: String,
    evidence: { type: Object, default: {} },
    possibleNormalReasons: { type: [String], default: [] },
    requiresReview: { type: Boolean, default: true },
    explanationSource: { type: String, enum: ['openai', 'template'], default: 'template' },
    routedToRole: { type: String, default: 'field_officer' },
    ownerUserId: { type: String, default: null },
    status: {
      type: String,
      enum: ['new', 'acknowledged', 'in_progress', 'escalated', 'resolved', 'dismissed'],
      default: 'new',
    },
    history: [historySchema],
    resolvedAt: { type: Date, default: null },
    simulated: { type: Boolean, default: true },
  },
  { timestamps: true }
);

// Dedup key: one OPEN alert per agent+subtype+provider (sim tick upserts into it).
alertSchema.index({ agentId: 1, subtype: 1, provider: 1, status: 1 });

export default mongoose.model('Alert', alertSchema);
