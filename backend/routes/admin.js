const express = require('express');
const router = express.Router();
const Booking = require('../models/Booking');
const Bus = require('../models/Bus');
const Route = require('../models/Route');
const Trip = require('../models/Trip');

function normalizeRouteValue(routeValue) {
  return String(routeValue || '').trim().toLowerCase().replace(/\s+/g, '');
}

function buildSeatsFromTrip(trip, bookingId) {
  if (!trip || !Array.isArray(trip.seats)) {
    return [];
  }

  return trip.seats
    .filter((seat) => seat.booking_id === bookingId)
    .map((seat) => ({
      seat_number: seat.seat_number,
      status: seat.status
    }))
    .sort((left, right) => left.seat_number - right.seat_number);
}

async function resolveRouteDocument(routeValue) {
  const normalized = normalizeRouteValue(routeValue);
  if (!normalized) {
    return null;
  }

  const parts = normalized.split('-');
  if (parts.length !== 2) {
    return null;
  }

  const [from_location, to_location] = parts;
  return Route.findOne({ from_location, to_location }).lean();
}

router.get('/bookings', async (req, res) => {
  try {
    const bookings = await Booking.find({}).sort({ createdAt: -1 }).populate('bus').populate('trip').lean();

    const response = bookings.map((booking) => ({
      booking_id: booking.booking_id,
      bus_id: booking.bus?.plate || null,
      destination: booking.destination,
      total_amount: booking.total_amount,
      status: booking.status,
      created_at: booking.createdAt || booking.created_at,
      seats: buildSeatsFromTrip(booking.trip, booking.booking_id)
    }));

    res.json(response);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Database error' });
  }
});

router.post('/trips', async (req, res) => {
  const { bus_id, route, departure_time, trip_date, status } = req.body;

  if (!bus_id || !route || !departure_time || !trip_date) {
    return res.status(400).json({ error: 'Missing trip details' });
  }

  try {
    const bus = await Bus.findOne({ plate: String(bus_id).trim() }).lean();
    if (!bus) {
      return res.status(404).json({ error: 'Bus not found' });
    }

    const routeDocument = await resolveRouteDocument(route);
    if (!routeDocument) {
      return res.status(404).json({ error: 'Route not found' });
    }

    const seats = Array.from({ length: bus.capacity }, (_, index) => ({
      seat_number: index + 1,
      status: 'available',
      booking_id: null,
      reserved_by: null,
      expires_at: null
    }));

    const trip = await Trip.create({
      bus: bus._id,
      route: routeDocument._id,
      departure_time,
      trip_date,
      status: status || 'active',
      seats
    });

    res.json({ success: true, trip_id: trip._id });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to create trip' });
  }
});

module.exports = router;
