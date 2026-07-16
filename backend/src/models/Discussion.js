const mongoose = require('mongoose');

const UserRefSchema = new mongoose.Schema(
  {
    id: { type: String, default: '' },
    name: { type: String, default: '' },
    display_name: { type: String, default: '' },
    email: { type: String, default: '' },
  },
  { _id: false }
);

const DiscussionSchema = new mongoose.Schema(
  {
    discussion_id: { type: String, required: true, unique: true, index: true },
    content: { type: String, required: true },
    author: { type: UserRefSchema, default: () => ({}) },
    channel: { type: String, default: '' },
    thread: { type: String, default: '' },
    workspace_id: { type: String, default: '' },
    team: { type: String, default: '' },
    task_id: { type: String, default: null },
    issue_id: { type: String, default: null },
    slack_message_ts: { type: String, default: '' },
    mentioned_users: { type: [UserRefSchema], default: [] },
    tags: { type: [String], default: [] },
    flagged_for_review: { type: Boolean, default: false },
    confidence_score: { type: Number, default: 0 },
    timestamp: { type: Date, default: Date.now },
  },
  { timestamps: true }
);

module.exports = mongoose.model('Discussion', DiscussionSchema);
