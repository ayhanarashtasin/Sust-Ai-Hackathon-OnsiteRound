import mongoose from 'mongoose';

const transactionSchema = new mongoose.Schema(
  {
    txnId: { type: String, required: true, unique: true },
    agentId: { type: String, required: true },
    provider: { type: String, enum: ['bKash', 'Nagad', 'Rocket'], required: true },
    type: {
      type: String,
      enum: ['cash_in', 'cash_out', 'send_money', 'payment', 'b2b_topup'],
      required: true,
    },
    amount: { type: Number, required: true },
    status: { type: String, enum: ['success', 'failed', 'pending'], default: 'success' },
    failureReason: { type: String, enum: ['insufficient_funds', 'provider_error', null], default: null },
    customerHash: { type: String, required: true }, // synthetic anonymized id — NOT a real identity
    timestamp: { type: Date, required: true },
    balanceAfter: {
      cash: Number,
      emoney: Number,
    },
    simulated: { type: Boolean, default: true },
  },
  { timestamps: true }
);

// Window scans run on every sim tick — this index keeps them off table scans.
transactionSchema.index({ agentId: 1, provider: 1, timestamp: -1 });

export default mongoose.model('Transaction', transactionSchema);
