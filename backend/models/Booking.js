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
  status: { type: String, default: 'pending' }
}, {
  timestamps: true
});

// Partial unique index: only one active booking per phone number
BookingSchema.index(
  { phone_number: 1 },
  { unique: true, partialFilterExpression: { status: { $in: ['reserved', 'booked'] } } }
);

module.exports = mongoose.model('Booking', BookingSchema);
