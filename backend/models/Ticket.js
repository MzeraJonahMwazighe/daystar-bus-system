const mongoose = require('mongoose');

const TicketSchema = new mongoose.Schema({
  ticket_id: { type: String, required: true, unique: true },
  booking_id: { type: String, required: true },
  bus: { type: mongoose.Schema.Types.ObjectId, ref: 'Bus', required: true },
  seats: { type: String, required: true },
  destination: { type: String, required: true },
  amount: { type: Number, required: true },
  qr_data: { type: String },
  status: { type: String, default: 'active' }
}, {
  timestamps: true
});

module.exports = mongoose.model('Ticket', TicketSchema);
