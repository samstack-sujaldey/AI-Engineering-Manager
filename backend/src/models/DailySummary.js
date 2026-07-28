const mongoose = require('mongoose');

const DailySummarySchema = new mongoose.Schema(
  {
    date: { type: String, required: true, index: true },
    channel: { type: String, default: '', index: true },
    summary: { type: String, required: true },
    tasks_count: { type: Number, default: 0 },
    issues_count: { type: Number, default: 0 },
    discussions_count: { type: Number, default: 0 },
    is_stale: { type: Boolean, default: false },
    // Lets you tell at a glance (or query for) whether this particular
    // cached summary actually came from the AI call or fell back to the
    // deterministic per-member breakdown because callOpenAI failed/returned
    // nothing that day.
    generated_by: { type: String, enum: ['ai', 'fallback'], default: 'fallback' },
  },
  { timestamps: true }
);

DailySummarySchema.index({ date: 1, channel: 1 }, { unique: true });

module.exports = mongoose.model('DailySummary', DailySummarySchema);