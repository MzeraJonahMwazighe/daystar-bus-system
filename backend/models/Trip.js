const mongoose = require('mongoose');

const TripSchema = new mongoose.Schema({
  bus: { type: mongoose.Schema.Types.ObjectId, ref: 'Bus', required: true },
  route: { type: mongoose.Schema.Types.ObjectId, ref: 'Route', required: true },
  trip_date: { type: String, required: true },
  departure_time: { type: String, required: true },
  status: { type: String, default: 'active' },
  seats: [
    {
      seat_number: { type: Number, required: true },
      status: { type: String, default: 'available' },
      booking_id: { type: String, default: null },
      reserved_by: { type: String, default: null },
      expires_at: { type: Date, default: null }
    }
  ]
}, {
  timestamps: true
});

module.exports = mongoose.model('Trip', TripSchema);
