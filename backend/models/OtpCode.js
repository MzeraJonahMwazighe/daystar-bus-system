const mongoose = require('mongoose');

const OtpCodeSchema = new mongoose.Schema({
  email: { type: String, required: true, lowercase: true, trim: true, index: true },
  code_hash: { type: String, required: true },
  expires_at: { type: Date, required: true },
  used: { type: Boolean, default: false },
  attempts: { type: Number, default: 0 }
}, {
  timestamps: true
});

OtpCodeSchema.index({ expires_at: 1 }, { expireAfterSeconds: 0 });

module.exports = mongoose.model('OtpCode', OtpCodeSchema);