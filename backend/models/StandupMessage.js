import mongoose from 'mongoose';

const standupMessageSchema = new mongoose.Schema({
  standupId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Standup',
    required: true
  },
  memberId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Member',
    required: true
  },
  rawMessage: {
    type: String,
    required: true
  },
  parsed: {
    type: Boolean,
    required: false,
    default: false
  }
});

// One StandupMessage per Standup. Combined with the Standup-level
// (slackChannelId, slackTs) unique index, this makes it structurally
// impossible to double-insert the same Slack message.
standupMessageSchema.index({ standupId: 1 }, { unique: true });

export default mongoose.model('StandupMessage', standupMessageSchema);
