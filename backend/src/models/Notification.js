const mongoose = require('mongoose');

const NotificationSchema = new mongoose.Schema(
  {
    notification_id: { type: String, required: true, unique: true },
    type: {
      type: String,
      enum: [
        'MISSING_DUE_DATE',
        'DUE_DATE_REMINDER',
        'MISSING_BLOCK_REASON',
        'BLOCK_REASON_REMINDER',
        'DEPENDENT_USER',
        'ACKNOWLEDGEMENT_REMINDER',
        'HUMAN_REVIEW',
        'GENERAL',
      ],
      required: true,
    },
    target_user_id: { type: String, required: true },
    target_user_name: { type: String, default: '' },
    message: { type: String, required: true },
    task_id: { type: String, default: null },
    issue_id: { type: String, default: null },
    status: {
      type: String,
      enum: ['PENDING', 'SENT', 'ACKNOWLEDGED', 'CANCELLED'],
      default: 'PENDING',
    },
    slack_dm_ts: { type: String, default: '' },
    sent_at: { type: Date, default: null },
    next_reminder_at: { type: Date, default: null },
    meta: { type: mongoose.Schema.Types.Mixed, default: {} },
  },
  { timestamps: true }
);

module.exports = mongoose.model('Notification', NotificationSchema);
