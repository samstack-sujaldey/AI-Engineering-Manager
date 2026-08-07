const mongoose = require('mongoose');

const UserSchema = new mongoose.Schema(
  {
    email: { type: String, trim: true, required: true, unique: true },
    password: { type: String, required: true },
    role: {
      type: String,
      enum: ['admin', 'manager', 'developer', 'viewer'],
      default: 'developer',
    },
    active: { type: Boolean, default: true },
  },
  { timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' } }
);

module.exports = mongoose.model('User', UserSchema);