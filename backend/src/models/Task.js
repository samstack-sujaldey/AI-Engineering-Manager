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

const TaskSchema = new mongoose.Schema(
  {
    task_id: { type: String, required: true, unique: true, index: true },
    title: { type: String, required: true },
    description: { type: String, default: '' },
    owner: { type: UserRefSchema, default: () => ({ id: '', name: 'Unassigned' }) },
    assigned_to: { type: UserRefSchema, default: () => ({ id: '', name: 'Unassigned' }) },
    assigned_by: { type: UserRefSchema, default: () => ({}) },
    reporter: { type: UserRefSchema, default: () => ({}) },
    created_by: { type: UserRefSchema, default: () => ({}) },
    last_updated_by: { type: UserRefSchema, default: () => ({}) },
    mentioned_users: { type: [UserRefSchema], default: [] },
    watcher_users: { type: [UserRefSchema], default: [] },
    reviewer_users: { type: [UserRefSchema], default: [] },
    priority: {
      type: String,
      enum: ['LOW', 'MEDIUM', 'HIGH', 'URGENT'],
      default: 'MEDIUM',
    },
    status: {
      type: String,
      enum: ['TODO', 'PROCESSING', 'COMPLETED', 'BLOCKED'],
      default: 'TODO',
    },
    due_date: { type: Date, default: null },
    due_date_pending: { type: Boolean, default: false },
    due_date_notification_at: { type: Date, default: null },
    needs_assignment: { type: Boolean, default: false },
    blocked_reason: { type: String, default: '' },
    block_reason_pending: { type: Boolean, default: false },
    block_reason_notification_at: { type: Date, default: null },
    blocking_user: { type: UserRefSchema, default: null },
    blocking_team: { type: String, default: '' },
    expected_resolution: { type: String, default: '' },
    dependencies: { type: [String], default: [] },
    related_issues: { type: [String], default: [] },
    related_discussions: { type: [String], default: [] },
    tags: { type: [String], default: [] },
    confidence_score: { type: Number, default: 0 },
    channel: { type: String, default: '' },
    thread: { type: String, default: '' },
    workspace_id: { type: String, default: '' },
    team: { type: String, default: '' },
    slack_message_ts: { type: String, default: '' },
    awaiting_acknowledgement: {
      user: { type: UserRefSchema, default: null },
      acknowledged: { type: Boolean, default: false },
      notification_at: { type: Date, default: null },
    },
    entities: {
      repository: { type: String, default: '' },
      branch: { type: String, default: '' },
      commit: { type: String, default: '' },
      pull_request: { type: String, default: '' },
      ticket: { type: String, default: '' },
      sprint: { type: String, default: '' },
      urls: { type: [String], default: [] },
      files: { type: [String], default: [] },
    },
    history: [
      {
        event: String,
        by: UserRefSchema,
        at: { type: Date, default: Date.now },
        details: mongoose.Schema.Types.Mixed,
      },
    ],
  },
  { timestamps: { createdAt: 'created_time', updatedAt: 'updated_time' } }
);

TaskSchema.index({ title: 'text', description: 'text' });
TaskSchema.index({ status: 1, priority: 1, due_date: 1 });

module.exports = mongoose.model('Task', TaskSchema);
