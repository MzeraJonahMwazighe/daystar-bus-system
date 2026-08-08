const mongoose = require('mongoose');

const PaymentSchema = new mongoose.Schema({
  transaction_id: { type: String, required: true, unique: true },
  booking_id: { type: String, required: true },
  phone_number: { type: String, required: true },
  amount: { type: Number, required: true },
  status: { type: String, default: 'pending' },
  payment_method: { type: String, default: 'mpesa' }
}, {
  timestamps: true
});

module.exports = mongoose.model('Payment', PaymentSchema);
