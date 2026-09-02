const mongoose = require('mongoose');

const StopSchema = new mongoose.Schema({
  name: { type: String, required: true },
  order: { type: Number, required: true },
  zone: {
    type: String,
    required: true,
    enum: ['valley_road_side', 'athi_river_side']
  }
}, { _id: false });

const RouteSchema = new mongoose.Schema({
  from_location: { type: String, required: true },
  to_location: { type: String, required: true },
  fare_per_seat: { type: Number, required: true },
  stops: { type: [StopSchema], default: [] }
}, {
  timestamps: true
});

module.exports = mongoose.model('Route', RouteSchema);
