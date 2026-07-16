const mongoose = require('mongoose');

const ActivitySchema = new mongoose.Schema(
  {
    activity_id: { type: String, required: true, unique: true },
    type: { type: String, required: true },
    summary: { type: String, required: true },
    actor: {
      id: String,
      name: String,
      display_name: String,
    },
    task_id: { type: String, default: null },
    issue_id: { type: String, default: null },
    discussion_id: { type: String, default: null },
    channel: { type: String, default: '' },
    thread: { type: String, default: '' },
    payload: { type: mongoose.Schema.Types.Mixed, default: {} },
  },
  { timestamps: { createdAt: 'created_at', updatedAt: false } }
);

module.exports = mongoose.model('Activity', ActivitySchema);
