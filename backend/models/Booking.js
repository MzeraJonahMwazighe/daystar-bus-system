const mongoose = require('mongoose');

const BookingSchema = new mongoose.Schema({
  booking_id: { type: String, required: true, unique: true },
  bus: { type: mongoose.Schema.Types.ObjectId, ref: 'Bus', required: true },
  trip: { type: mongoose.Schema.Types.ObjectId, ref: 'Trip' },
  seats: { type: String, required: true },
  boardingStop: { type: String, required: true },
  alightingStop: { type: String, required: true },
  destination: { type: String, required: true },
  total_amount: { type: Number, required: true },
  // Set when a logged-in student makes the booking; guest bookings leave it empty.
  student: { type: mongoose.Schema.Types.ObjectId, ref: 'Student', default: null, index: true },
  passenger_name: { type: String },
  phone_number: { type: String },
  checkout_request_id: { type: String, index: true },
  mpesa_receipt_number: { type: String },
  mpesa_transaction_date: { type: String },
  mpesa_phone_number: { type: String },
  payment_method: { type: String, default: 'mpesa' },
  // reserved -> booked, or expired (not paid in time).
  // When an admin cancels the trip: cancelled (nothing was paid in M-Pesa) or
  // refund_due (paid by M-Pesa; an admin refunds it by hand, then marks it refunded).
  // A payment that arrives after a booking expired or was cancelled also becomes refund_due.
  status: { type: String, default: 'pending' },
  refunded_at: { type: Date, default: null },
  refunded_by: { type: mongoose.Schema.Types.ObjectId, ref: 'Staff', default: null }
}, {
  timestamps: true
});

// Partial unique index: one active booking per phone number on each trip, so a student
// can hold the morning trip and the trip home at the same time.
// db.js runs Booking.syncIndexes() at startup, which also drops the old phone-only index.
BookingSchema.index(
  { phone_number: 1, trip: 1 },
  { unique: true, partialFilterExpression: { status: { $in: ['reserved', 'booked'] } } }
);
BookingSchema.index({ trip: 1, status: 1 });

module.exports = mongoose.model('Booking', BookingSchema);
