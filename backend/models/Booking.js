const mongoose = require('mongoose');

const BookingSchema = new mongoose.Schema({
  booking_id: { type: String, required: true, unique: true },
  bus: { type: mongoose.Schema.Types.ObjectId, ref: 'Bus', required: true },
  trip: { type: mongoose.Schema.Types.ObjectId, ref: 'Trip' },
  seats: { type: String, required: true },
  destination: { type: String, required: true },
  total_amount: { type: Number, required: true },
  passenger_name: { type: String },
  phone_number: { type: String },
  checkout_request_id: { type: String, index: true },
  mpesa_receipt_number: { type: String },
  mpesa_transaction_date: { type: String },
  mpesa_phone_number: { type: String },
  status: { type: String, default: 'pending' }
}, {
  timestamps: true
});

module.exports = mongoose.model('Booking', BookingSchema);
