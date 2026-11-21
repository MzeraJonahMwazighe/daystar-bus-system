const mongoose = require('mongoose');

const BusSchema = new mongoose.Schema({
  plate: { type: String, required: true, unique: true },
  capacity: { type: Number, required: true },
  type: { type: String, required: true },
  route: { type: String, required: true },
  // Bumped inside every trip create/edit that uses this bus. Two admins scheduling the same
  // bus at once both write this field, so MongoDB lets only one transaction through and the
  // other retries and sees the first trip in its clash check.
  schedule_version: { type: Number, default: 0 }
}, {
  timestamps: true
});

module.exports = mongoose.model('Bus', BusSchema);
