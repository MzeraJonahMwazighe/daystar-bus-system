const express = require('express');
const mongoose = require('mongoose');
const Trip = require('../models/Trip');
const { bookableDates, countTakenSeats, isTripBookable, seatIsTaken, sortedStops } = require('../lib/tripSchedule');

const router = express.Router();

function serializePublicTrip(trip, now) {
  const capacity = Array.isArray(trip.seats) ? trip.seats.length : 0;
  return {
    id: String(trip._id),
    trip_date: trip.trip_date,
    departure_time: trip.departure_time,
    departs_at: trip.departs_at,
    from: trip.route?.from_location || null,
    to: trip.route?.to_location || null,
    bus_plate: trip.bus?.plate || null,
    bus_type: trip.bus?.type || null,
    capacity,
    seats_left: Math.max(0, capacity - countTakenSeats(trip, now))
  };
}

// Trips students can book right now: scheduled, not left yet, leaving today or tomorrow.
router.get('/', async (req, res) => {
  const now = new Date();
  try {
    const trips = await Trip.find({
      status: 'scheduled',
      trip_date: { $in: bookableDates(now) },
      departs_at: { $gt: now }
    })
      .sort({ departs_at: 1 })
      .populate('route', 'from_location to_location')
      .populate('bus', 'plate type')
      .lean();

    res.json({ dates: bookableDates(now), trips: trips.map((trip) => serializePublicTrip(trip, now)) });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Database error' });
  }
});

// One trip with its stops and taken seats, for the seat picker.
router.get('/:id', async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) {
    return res.status(400).json({ error: 'Invalid trip ID' });
  }
  const now = new Date();
  try {
    const trip = await Trip.findById(req.params.id)
      .populate('route')
      .populate('bus', 'plate type')
      .lean();
    if (!trip || trip.status === 'active') {
      return res.status(404).json({ error: 'Trip not found' });
    }

    res.json({
      ...serializePublicTrip(trip, now),
      status: trip.status,
      bookable: isTripBookable(trip, now),
      routeId: trip.route?._id ? String(trip.route._id) : null,
      stops: sortedStops(trip.route),
      bookedSeats: (trip.seats || [])
        .filter((seat) => seatIsTaken(seat, now))
        .map((seat) => ({ seat_number: seat.seat_number, status: seat.status }))
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Database error' });
  }
});

module.exports = router;
