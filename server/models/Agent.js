import mongoose from 'mongoose';

/*
  Agent outlet — ONE physical cash drawer, SEPARATE e-money balance per provider.

    ┌───────────── Agent outlet ─────────────┐
    │  cashBalance (shared physical drawer)  │
    │  providers[]:                          │
    │    bKash  emoneyBalance  (separate)    │
    │    Nagad  emoneyBalance  (separate)    │
    │    Rocket emoneyBalance  (separate)    │
    └────────────────────────────────────────┘
  Provider balances are logically separate — never converted or merged.
*/
const providerBalanceSchema = new mongoose.Schema(
  {
    provider: { type: String, enum: ['bKash', 'Nagad', 'Rocket'], required: true },
    emoneyBalance: { type: Number, required: true, min: 0 },
    openingBalance: { type: Number, required: true, min: 0 },
    floorThreshold: { type: Number, default: 5000, min: 0 },
    criticalThreshold: { type: Number, default: 2500, min: 0 },
    balanceTimestamp: { type: Date, default: Date.now },
    dataReceivedAt: { type: Date, default: Date.now },
    dataStatus: { type: String, enum: ['fresh', 'stale', 'missing', 'conflicting'], default: 'fresh' },
    reconciliationBalance: { type: Number, default: null },
    reconciliationAt: { type: Date, default: null },
  },
  { _id: false }
);

const agentSchema = new mongoose.Schema(
  {
    agentId: { type: String, required: true, unique: true },
    name: { type: String, required: true },
    area: { type: String, required: true },
    thana: { type: String, default: '' },
    district: { type: String, default: '' },
    status: { type: String, enum: ['active', 'inactive', 'unavailable'], default: 'active' },
    cashBalance: { type: Number, required: true, min: 0 },
    cashOpeningBalance: { type: Number, required: true, min: 0 },
    cashFloorThreshold: { type: Number, default: 10000, min: 0 },
    cashCriticalThreshold: { type: Number, default: 5000, min: 0 },
    cashReconciliationBalance: { type: Number, default: null },
    cashReconciliationAt: { type: Date, default: null },
    providers: [providerBalanceSchema],
    // Feed staleness per provider (data-quality engine reads this)
    lastFeedAt: { type: Map, of: Date, default: {} },
    simulated: { type: Boolean, default: true },
  },
  { timestamps: true }
);

export default mongoose.model('Agent', agentSchema);
