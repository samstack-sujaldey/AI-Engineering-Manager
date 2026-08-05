const mongoose = require('mongoose');

const UserSchema = new mongoose.Schema(
  {
    password: { type: String, required: true },
    role: {
      type: String,
      enum: ['admin', 'manager', 'developer', 'viewer'],
      default: 'developer',
    },
    email: { type: String, trim: true, default: '' },
    active: { type: Boolean, default: true },
  },
  { timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' } }
);

UserSchema.index({ username: 1 });

module.exports = mongoose.model('User', UserSchema);
