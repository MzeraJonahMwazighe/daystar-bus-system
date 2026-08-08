const mongoose = require('mongoose');

const RouteSchema = new mongoose.Schema({
  from_location: { type: String, required: true },
  to_location: { type: String, required: true },
  fare_per_seat: { type: Number, required: true }
}, {
  timestamps: true
});

module.exports = mongoose.model('Route', RouteSchema);
