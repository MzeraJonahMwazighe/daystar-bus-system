const mongoose = require('mongoose');

const OtpRateLimitSchema = new mongoose.Schema({
  email: {
    type: String,
    required: true,
    unique: true,
    lowercase: true,
    trim: true
  },
  last_requested_at: {
    type: Date,
    required: true
  },
  window_started_at: {
    type: Date,
    required: true
  },
  request_count: {
    type: Number,
    required: true,
    default: 0,
    min: 0
  }
}, {
  timestamps: true
});

module.exports = mongoose.model('OtpRateLimit', OtpRateLimitSchema);