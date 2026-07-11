import mongoose from 'mongoose';

// Staff console login ONLY. Never customer wallet credentials (no PIN/OTP).
const userSchema = new mongoose.Schema(
  {
    name: { type: String, required: true },
    email: { type: String, required: true, unique: true, lowercase: true },
    passwordHash: { type: String, required: true },
    role: {
      type: String,
      required: true,
      enum: ['agent', 'field_officer', 'ops', 'risk', 'management'],
    },
    area: { type: String, default: null }, // scoping for field_officer
    providerScope: { type: [String], default: ['all'] }, // ops teams are provider-specific
    agentId: { type: String, default: null }, // set when role === 'agent'
    simulated: { type: Boolean, default: true }, // every document in this prototype is synthetic
  },
  { timestamps: true }
);

export default mongoose.model('User', userSchema);
