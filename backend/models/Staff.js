const mongoose = require('mongoose');

const STAFF_ROLES = ['super_admin', 'campus_admin', 'driver'];
// Same keys the admin page and Route documents already use ('athi' / 'nairobi').
const STAFF_CAMPUSES = ['athi', 'nairobi'];

const StaffSchema = new mongoose.Schema({
  email: {
    type: String,
    required: true,
    unique: true,
    lowercase: true,
    trim: true,
    match: /^[^\s@]+@[^\s@]+\.[^\s@]+$/
  },
  name: { type: String, required: true, trim: true },
  role: { type: String, required: true, enum: STAFF_ROLES },
  campus: { type: String, enum: [...STAFF_CAMPUSES, null], default: null },
  phone_number: { type: String, trim: true },
  active: { type: Boolean, default: true },
  // Drivers only: bumped inside every trip create/edit that assigns them (see Bus.schedule_version).
  schedule_version: { type: Number, default: 0 }
}, {
  timestamps: true
});

StaffSchema.pre('validate', function requireCampusForCampusAdmin(next) {
  if (this.role === 'campus_admin' && !this.campus) {
    this.invalidate('campus', 'A campus admin must be assigned to a campus');
  }
  next();
});

module.exports = mongoose.model('Staff', StaffSchema);
module.exports.STAFF_ROLES = STAFF_ROLES;
module.exports.STAFF_CAMPUSES = STAFF_CAMPUSES;
