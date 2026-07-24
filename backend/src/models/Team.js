const mongoose = require('mongoose');

const UserRefSchema = new mongoose.Schema(
  {
    id: { type: String, default: '' },
    name: { type: String, default: '' },
    display_name: { type: String, default: '' },
    real_name: { type: String, default: '' },
    email: { type: String, default: '' },
  },
  { _id: false }
);

const TeamSchema = new mongoose.Schema(
  {
    team_id: { type: String, required: true, unique: true, index: true },
    channel_id: { type: String, required: true, index: true },
    channel_name: { type: String, default: '' },
    workspace_id: { type: String, default: '' },
    team: { type: String, default: '' },
    members: { type: [UserRefSchema], default: [] },
    member_count: { type: Number, default: 0 },
    last_synced_at: { type: Date, default: null },
  },
  { timestamps: { createdAt: 'created_time', updatedAt: 'updated_time' } }
);

module.exports = mongoose.model('Team', TeamSchema);
