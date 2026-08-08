const mongoose = require('mongoose');

const BusSchema = new mongoose.Schema({
  plate: { type: String, required: true, unique: true },
  capacity: { type: Number, required: true },
  type: { type: String, required: true },
  route: { type: String, required: true }
}, {
  timestamps: true
});

module.exports = mongoose.model('Bus', BusSchema);
