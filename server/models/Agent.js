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
    emoneyBalance: { type: Number, required: true },
    openingBalance: { type: Number, required: true },
    floorThreshold: { type: Number, default: 5000 },
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
    cashBalance: { type: Number, required: true },
    cashOpeningBalance: { type: Number, required: true },
    cashFloorThreshold: { type: Number, default: 10000 },
    providers: [providerBalanceSchema],
    // Feed staleness per provider (data-quality engine reads this)
    lastFeedAt: { type: Map, of: Date, default: {} },
    simulated: { type: Boolean, default: true },
  },
  { timestamps: true }
);

export default mongoose.model('Agent', agentSchema);
