const mongoose = require('mongoose');

const StudentSchema = new mongoose.Schema({
  email: {
    type: String,
    required: true,
    unique: true,
    lowercase: true,
    trim: true,
    match: /^[a-z0-9._%+-]+@daystar\.ac\.ke$/i
  },
  name: { type: String, required: true },
  admission_number: { type: String, required: true },
  phone_number: { type: String },
  has_bus_pass: { type: Boolean, default: false },
  pass_valid_from: { type: Date },
  pass_valid_until: { type: Date },
  pass_route: { type: String }
}, {
  timestamps: true
});

module.exports = mongoose.model('Student', StudentSchema);