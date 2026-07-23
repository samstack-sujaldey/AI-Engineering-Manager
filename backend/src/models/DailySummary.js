const mongoose = require('mongoose');

const DailySummarySchema = new mongoose.Schema(
  {
    date: { type: String, required: true, unique: true, index: true }, // e.g. "2026-07-21"
    summary: { type: String, required: true },
    tasks_count: { type: Number, default: 0 },
    issues_count: { type: Number, default: 0 },
    discussions_count: { type: Number, default: 0 },
    is_stale: { type: Boolean, default: false }, // Set to true when new task/issue is created
  },
  { timestamps: true }
);

module.exports = mongoose.model('DailySummary', DailySummarySchema);