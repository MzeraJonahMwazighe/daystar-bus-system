const express = require('express');
const mongoose = require('mongoose');
const router = express.Router();
const { calculateZoneFare, generateTicketNumber, validatePhoneNumber } = require('../lib/bookingHelpers');
const Booking = require('../models/Booking');
const Trip = require('../models/Trip');
const { isTripBookable } = require('../lib/tripSchedule');
const { optionalStudentAuth } = require('../middleware/requireStudentAuth');
const { requireStaff } = require('../middleware/requireStaffAuth');
const { confirmBookingPayment } = require('../lib/paymentHelpers');

function serializeBooking(booking) {
  return {
    booking_id: booking.booking_id,
    bus_id: booking.bus?.plate || null,
    seats: booking.seats,
    boardingStop: booking.boardingStop,
    alightingStop: booking.alightingStop,
    destination: booking.destination,
    total_amount: booking.total_amount,
    status: booking.status,
    payment_method: booking.payment_method || 'mpesa',
    trip_id: booking.trip?._id ? String(booking.trip._id) : (booking.trip ? String(booking.trip) : null),
    trip_date: booking.trip?.trip_date || null,
    departure_time: booking.trip?.departure_time || null,
    created_at: booking.createdAt || booking.created_at
  };
}

async function releaseSeats(tripId, bookingId) {
  await Trip.updateOne(
    { _id: tripId },
    {
      $set: {
        'seats.$[elem].status': 'available',
        'seats.$[elem].booking_id': null,
        'seats.$[elem].reserved_by': null,
        'seats.$[elem].expires_at': null
      }
    },
    { arrayFilters: [{ 'elem.booking_id': bookingId, 'elem.status': 'reserved' }] }
  );
}

// Listing every booking is an admin-only view.
router.get('/', requireStaff('campus_admin'), async (req, res) => {
  try {
    const bookings = await Booking.find({}).populate('bus').populate('trip', 'trip_date departure_time').lean();
    res.json(bookings.map(serializeBooking));
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Database error' });
  }
});

router.post('/', optionalStudentAuth, async (req, res) => {
  const { tripId, seats, boardingStop, alightingStop, passengerName, phoneNumber } = req.body;

  if (!tripId || !mongoose.isValidObjectId(tripId) || !seats || !Array.isArray(seats) || seats.length === 0) {
    return res.status(400).json({ error: 'Invalid booking data - tripId, seats (array), boardingStop, and alightingStop required' });
  }

  const normalizedBoardingStop = String(boardingStop || '').trim();
  const normalizedAlightingStop = String(alightingStop || '').trim();

  if (!normalizedBoardingStop || !normalizedAlightingStop) {
    return res.status(400).json({ error: 'Boarding stop and alighting stop are required' });
  }

  if (normalizedBoardingStop === normalizedAlightingStop) {
    return res.status(400).json({ error: 'Boarding stop and alighting stop must be different' });
  }

  if (!passengerName || !phoneNumber) {
    return res.status(400).json({ error: 'Passenger name and phone number are required' });
  }

  if (!validatePhoneNumber(phoneNumber)) {
    return res.status(400).json({ error: 'Please enter a valid phone number' });
  }

  const requestedSeatNumbers = seats.map(Number);
  if (requestedSeatNumbers.some(seat => !Number.isInteger(seat) || seat <= 0)) {
    return res.status(400).json({ error: 'Seat numbers must be positive integers' });
  }

  const uniqueSeatNumbers = [...new Set(requestedSeatNumbers)];
  if (uniqueSeatNumbers.length !== requestedSeatNumbers.length) {
    return res.status(400).json({ error: 'Duplicate seat numbers are not allowed' });
  }

  try {
    const trip = await Trip.findById(tripId).populate('route').lean();
    if (!trip) {
      return res.status(404).json({ error: 'Trip not found' });
    }

    if (!isTripBookable(trip)) {
      return res.status(409).json({ error: 'This trip can no longer be booked. It may have left or been cancelled.' });
    }

    if (uniqueSeatNumbers.some(seat => seat > trip.seats.length)) {
      return res.status(400).json({ error: 'One or more requested seats do not exist on this bus' });
    }

    let farePerSeat;
    try {
      farePerSeat = calculateZoneFare(normalizedBoardingStop, normalizedAlightingStop, trip.route);
    } catch (error) {
      return res.status(400).json({ error: error.message });
    }

    const tripDate = new Date(`${trip.trip_date}T00:00:00.000Z`);
    const routeId = String(trip.route?._id || trip.route);
    const student = req.student;
    const passCoversTrip = Boolean(
      student?.has_bus_pass &&
      student.pass_valid_from &&
      student.pass_valid_until &&
      !Number.isNaN(tripDate.getTime()) &&
      new Date(student.pass_valid_from) <= tripDate &&
      new Date(student.pass_valid_until) >= tripDate &&
      (student.pass_route === 'all' || String(student.pass_route) === routeId)
    );

    // Test hook used by backend/scripts/bookingRouteStressTest.js. Ignored in production
    // so a client can never choose its own booking ID on the live site.
    const bookingIdOverride = process.env.NODE_ENV !== 'production'
      ? req.headers['x-fixed-booking-id']
      : undefined;
    const bookingId = bookingIdOverride || generateTicketNumber();
    const expiresAt = new Date(Date.now() + 2 * 60 * 1000);
    const now = new Date();

    // The status and departure checks are part of the same atomic update, so a seat can't be
    // reserved on a trip that was cancelled or left a moment ago.
    const updatedTrip = await Trip.findOneAndUpdate(
      {
        _id: trip._id,
        status: 'scheduled',
        departs_at: { $gt: now },
        seats: {
          $not: {
            $elemMatch: {
              seat_number: { $in: uniqueSeatNumbers },
              $or: [
                { status: 'booked' },
                { status: 'reserved', expires_at: { $gt: now } }
              ]
            }
          }
        }
      },
      {
        $set: {
          'seats.$[elem].status': 'reserved',
          'seats.$[elem].booking_id': bookingId,
          'seats.$[elem].reserved_by': passengerName,
          'seats.$[elem].expires_at': expiresAt
        }
      },
      {
        arrayFilters: [{ 'elem.seat_number': { $in: uniqueSeatNumbers } }],
        new: true
      }
    );

    if (!updatedTrip) {
      return res.status(409).json({ error: 'Seats no longer available' });
    }

    const reservedSeats = updatedTrip.seats.filter(seat =>
      uniqueSeatNumbers.includes(seat.seat_number) &&
      seat.status === 'reserved' &&
      seat.booking_id === bookingId
    );

    if (reservedSeats.length !== uniqueSeatNumbers.length) {
      const rolledBackSeatNumbers = reservedSeats.map(seat => seat.seat_number);
      if (rolledBackSeatNumbers.length > 0) {
        await Trip.updateOne(
          { _id: trip._id },
          {
            $set: {
              'seats.$[elem].status': 'available',
              'seats.$[elem].booking_id': null,
              'seats.$[elem].reserved_by': null,
              'seats.$[elem].expires_at': null
            }
          },
          { arrayFilters: [{ 'elem.seat_number': { $in: rolledBackSeatNumbers } }] }
        );
      }
      return res.status(409).json({ error: 'Seats no longer available' });
    }

    const adjustedAmount = uniqueSeatNumbers.length * farePerSeat;
    const seatsString = uniqueSeatNumbers.join(',');

    let booking;
    try {
      booking = await Booking.create({
        booking_id: bookingId,
        bus: trip.bus,
        trip: trip._id,
        seats: seatsString,
        boardingStop: normalizedBoardingStop,
        alightingStop: normalizedAlightingStop,
        destination: normalizedAlightingStop,
        total_amount: adjustedAmount,
        student: student?._id || null,
        passenger_name: passengerName,
        phone_number: phoneNumber,
        status: 'reserved',
        payment_method: passCoversTrip ? 'pass' : 'mpesa'
      });
    } catch (createError) {
      // e.g. this phone already has a booking on this trip: give the seats straight back
      // instead of leaving them held for 2 minutes. (A booking_id clash is skipped: the
      // other booking with that ID owns those seat entries.)
      if (!(createError.code === 11000 && createError.keyPattern?.booking_id)) {
        await releaseSeats(trip._id, bookingId);
      }
      throw createError;
    }

    // If an admin cancelled the trip between our seat reservation and creating this booking,
    // the cancellation didn't see this booking yet. Undo it here.
    const tripNow = await Trip.findById(trip._id).select('status').lean();
    if (tripNow?.status !== 'scheduled') {
      await Booking.updateOne({ _id: booking._id, status: 'reserved' }, { $set: { status: 'cancelled' } });
      await releaseSeats(trip._id, bookingId);
      return res.status(409).json({ error: 'This trip was just cancelled. Please choose another trip.' });
    }

    if (passCoversTrip) {
      const ticket = await confirmBookingPayment(booking.booking_id);
      return res.json({
        success: true,
        booking_id: booking.booking_id,
        bookingId: booking.booking_id,
        payment_method: 'pass',
        status: 'booked',
        ticket_id: ticket.ticket_id
      });
    }

    return res.json({
      success: true,
      booking_id: booking.booking_id,
      bookingId: booking.booking_id,
      payment_method: 'mpesa'
    });
  } catch (error) {
    // Handle duplicate key errors
    if (error.code === 11000 && error.keyPattern) {
      if (error.keyPattern.booking_id) {
        return res.status(409).json({ error: 'Booking ID conflict, please retry' });
      }
      if (error.keyPattern.phone_number) {
        return res.status(409).json({ error: 'This phone number already has a booking on this trip. Please complete it or wait for the reservation to expire before booking again.' });
      }
    }

    console.error(error);
    res.status(500).json({ error: 'Database error' });
  }
});

router.get('/:bookingId', async (req, res) => {
  try {
    const booking = await Booking.findOne({ booking_id: req.params.bookingId })
      .populate('bus')
      .populate('trip', 'trip_date departure_time')
      .lean();
    if (!booking) {
      return res.status(404).json({ error: 'Booking not found' });
    }

    const response = serializeBooking(booking);
    response.seats = booking.seats ? booking.seats.split(',').map(Number) : [];
    res.json(response);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Database error' });
  }
});

module.exports = router;
