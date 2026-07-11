import mongoose from 'mongoose';

const predictionSchema = new mongoose.Schema(
  {
    predictionId: { type: String, required: true, unique: true },
    agentId: { type: String, required: true },
    provider: { type: String, enum: ['bKash', 'Nagad', 'Rocket', null], default: null },
    task: { type: String, enum: ['liquidity_shortage_60m', 'unusual_activity_review'], required: true },
    horizonMin: { type: Number, default: 60 },
    riskScore: { type: Number, min: 0, max: 1, default: null },
    confidenceScore: { type: Number, min: 0, max: 1, required: true },
    dataConfidence: { type: Number, min: 0, max: 1, required: true },
    decisionSource: { type: String, enum: ['hybrid', 'model', 'rules', 'rules_only'], required: true },
    modelType: { type: String, default: null },
    modelVersion: { type: String, default: null },
    featureSchemaVersion: { type: String, required: true },
    featureSnapshot: { type: Object, default: {} },
    triggeredRules: { type: [Object], default: [] },
    evidence: { type: [Object], default: [] },
    dataFreshness: { type: Object, default: {} },
    fallbackReason: { type: String, default: null },
    simulated: { type: Boolean, default: true },
  },
  { timestamps: true },
);

predictionSchema.index({ agentId: 1, provider: 1, task: 1, createdAt: -1 });

export default mongoose.model('Prediction', predictionSchema);
