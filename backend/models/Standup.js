import mongoose from 'mongoose';

const standupSchema = new mongoose.Schema({
  submittedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Member',
    required: true
  },
  teamId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Team',
    default: null
  },
  source: {
    type: String,
    enum: ['Manual', 'Slack', 'API'],
    default: 'Manual'
  },
  parsingStatus: {
    type: String,
    required: true,
    enum: ['Pending', 'Processing', 'Completed', 'Failed'],
    default: 'Pending'
  },
  message: {
    type: String,
    default: null
  },
  parsed: {
    type: Boolean,
    required: true,
    default: false
  },
  // ── Slack de-duplication ──────────────────────────────
  // Every Slack message has a stable per-channel timestamp (ts).
  // Keying on (slackChannelId, slackTs) lets us upsert instead of
  // blindly inserting, so hitting /process twice is a no-op for
  // messages already ingested.
  slackChannelId: {
    type: String,
    default: null
  },
  slackTs: {
    type: String,
    default: null
  }
}, { timestamps: { createdAt: true, updatedAt: false } });

// Sparse compound unique index: only applies to docs that actually have
// both Slack fields set, so Manual/API standups are unaffected.
standupSchema.index({ slackChannelId: 1, slackTs: 1 }, { unique: true, sparse: true });

export default mongoose.model('Standup', standupSchema);
