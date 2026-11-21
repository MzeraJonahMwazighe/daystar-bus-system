const mongoose = require('mongoose');

// scheduled -> departed -> completed, or cancelled. Drivers will move trips to departed /
// completed in Phase 5. 'active' is the status of trips made before Phase 3; nothing new uses it.
const TRIP_STATUSES = ['scheduled', 'departed', 'completed', 'cancelled', 'active'];

const TripSchema = new mongoose.Schema({
  bus: { type: mongoose.Schema.Types.ObjectId, ref: 'Bus', required: true },
  route: { type: mongoose.Schema.Types.ObjectId, ref: 'Route', required: true },
  // Nairobi local date and time, e.g. '2026-11-22' and '07:00'.
  trip_date: { type: String, required: true },
  departure_time: { type: String, required: true },
  // The same moment as a real date (trip_date + departure_time in Nairobi time).
  // Used for clash checks, sorting, and closing bookings at departure.
  departs_at: { type: Date },
  // Where the trip leaves from (the route's from_location), so each campus admin sees their own.
  campus: { type: String },
  driver: { type: mongoose.Schema.Types.ObjectId, ref: 'Staff', default: null },
  created_by: { type: mongoose.Schema.Types.ObjectId, ref: 'Staff', default: null },
  status: { type: String, enum: TRIP_STATUSES, default: 'scheduled' },
  cancelled_at: { type: Date, default: null },
  cancelled_by: { type: mongoose.Schema.Types.ObjectId, ref: 'Staff', default: null },
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

TripSchema.index({ trip_date: 1, campus: 1 });
TripSchema.index({ bus: 1, departs_at: 1 });
TripSchema.index({ driver: 1, departs_at: 1 });
TripSchema.index({ status: 1, departs_at: 1 });

module.exports = mongoose.model('Trip', TripSchema);
module.exports.TRIP_STATUSES = TRIP_STATUSES;
